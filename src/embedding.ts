import { BigQuery } from "@google-cloud/bigquery";
import { createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import * as fs from "fs";
import { get } from "http";

async function getLatestTimestampFromSupabase() {
  try {
    console.info("Checking Supabase for the latest document timestamp...");

    const sbApiKey = process.env.SUPABASE_API_KEY;
    const sbUrl = process.env.SUPABASE_URL;

    if (!sbApiKey || !sbUrl) {
      throw new Error("Missing Supabase environment variables");
    }

    const client = createClient(sbUrl, sbApiKey);

    // Query the metadata->timestamp directly
    const { data, error } = await client
      .from("lens")
      .select("metadata")
      .order("metadata->timestamp", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("Error fetching latest timestamp from Supabase:", error);
      throw error;
    }

    if (data && data.metadata) {
      const latestTimestamp = data.metadata.timestamp.value;
      console.info(`Latest timestamp in Supabase: ${latestTimestamp}`);
      return latestTimestamp;
    }

    console.info("No existing documents found in Supabase.");
    return null;
  } catch (err) {
    console.error("Error retrieving the latest timestamp from Supabase:", err);
    throw err;
  }
}

// Function to get all existing profile IDs from Supabase
async function getExistingProfileIds() {
  try {
    console.info("Fetching existing profile IDs from Supabase...");

    const sbApiKey = process.env.SUPABASE_API_KEY;
    const sbUrl = process.env.SUPABASE_URL;

    if (!sbApiKey || !sbUrl) {
      throw new Error("Missing Supabase environment variables");
    }

    const client = createClient(sbUrl, sbApiKey);

    const { data, error } = await client.rpc("get_distinct_authors");

    if (error) {
      console.error("Error fetching profile IDs from Supabase:", error);
      throw error;
    }

    const profileIds = data.map((row: { author: string }) => row.author);
    console.info(`Fetched ${profileIds.length} profile IDs from Supabase.`);
    return profileIds; // Return array of profile IDs*/
  } catch (err) {
    console.error("Error retrieving profile IDs from Supabase:", err);
    throw err;
  }
}

// Function to fetch and prepare documents from BigQuery
async function fetchAndPrepareDocuments() {
  try {
    console.info("Starting to fetch and prepare documents...");

    const existingProfileIds = await getExistingProfileIds();
    const existingProfileIdsString = existingProfileIds
      .map((id: string) => `'${id}'`)
      .join(",");

    // Initialize BigQuery client
    const bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: JSON.parse(process.env.GCP_KEYFILE || ""),
    });

    console.info("Fetching profiles with 10,000+ followers...");

    const queryNewProfiles = `
      SELECT profile_id, total_followers
      FROM \`lens-public-data.v2_polygon.global_stats_profile_follower\`
      WHERE CAST(total_followers AS INT64) > 10000
    `;

    const [profileRows] = await bigquery.query({ query: queryNewProfiles });
    const newProfiles = profileRows.filter(
      (row) => !existingProfileIds.includes(row.profile_id)
    );

    console.info(`Identified ${newProfiles.length} new profiles.`);
    console.log("newProfiles", newProfiles);

    const newProfileIdsString = newProfiles
      .map((profile) => `'${profile.profile_id}'`)
      .join(",");

    // Get the latest timestamp from Supabase
    const latestTimestamp = await getLatestTimestampFromSupabase();
    console.info(`Fetching posts newer than: ${latestTimestamp}`);

    // Fetch all posts for new profiles and recent posts for existing profiles
    const query = `
      SELECT pr.profile_id, pr.publication_id, pm.content, pm.main_content_focus, pr.publication_type, pr.parent_publication_id, pm.timestamp
      FROM \`lens-public-data.v2_polygon.publication_record\` pr
      JOIN \`lens-public-data.v2_polygon.publication_metadata\` pm
      ON pr.publication_id = pm.publication_id
      WHERE pr.publication_type != "MIRROR" 
      AND pr.is_hidden = false 
      AND LENGTH(pm.content) > 140
      AND (
        pr.profile_id IN (${newProfileIdsString})
        OR (pr.profile_id IN (${existingProfileIdsString}) AND pm.timestamp > TIMESTAMP("${latestTimestamp}"))
      )
    `;

    console.info("Executing BigQuery...");
    const [rows] = await bigquery.query({ query });
    console.info(`Query executed. Fetched ${rows.length} rows of content.`);

    if (rows.length === 0) {
      console.info("No documents to prepare.");
      return [];
    }

    const documents: Document<Record<string, any>>[] = rows.map((post) => {
      return {
        pageContent: post.content || " ",
        metadata: {
          publication_id: post.publication_id,
          main_content_focus: post.main_content_focus,
          author: post.profile_id, // Using profile ID as author
          publication_type: post.publication_type,
          parent_publication_id: post.parent_publication_id,
          timestamp: post.timestamp,
        },
      };
    });

    fs.writeFileSync("documents.json", JSON.stringify(documents, null, 2));

    console.info(`Prepared ${documents.length} documents for indexing.`);
    return documents;
  } catch (err) {
    console.error("Error fetching and preparing documents:", err);
    throw err;
  }
}

// Function to upload documents to Supabase
async function uploadDocumentsToSupabase(
  documents: Document<Record<string, any>>[]
) {
  try {
    console.info("Starting to upload documents to Supabase...");

    const sbApiKey = process.env.SUPABASE_API_KEY;
    const sbUrl = process.env.SUPABASE_URL;
    const openAIApiKey = process.env.OPENAI_API_KEY;

    if (!sbApiKey || !sbUrl || !openAIApiKey) {
      throw new Error("Missing environment variables");
    }

    const client = createClient(sbUrl, sbApiKey);

    const batchSize = 4000;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      console.info(
        `Uploading batch ${i / batchSize + 1} of ${Math.ceil(
          documents.length / batchSize
        )}...`
      );

      await SupabaseVectorStore.fromDocuments(
        batch,
        new OpenAIEmbeddings({ openAIApiKey }),
        {
          client,
          tableName: "lens",
        }
      );

      console.info(`Batch ${i / batchSize + 1} uploaded successfully.`);
    }

    console.info(
      `Successfully uploaded ${documents.length} documents to Supabase.`
    );
  } catch (err) {
    console.error("Error uploading documents to Supabase:", err);
    throw err;
  }
}

// Main function to execute the entire process
async function main() {
  try {
    console.info("Starting the full process...");
    const result = await getExistingProfileIds();
    console.log("result", result);

    const documents = await fetchAndPrepareDocuments();
    if (documents.length > 0) {
      await uploadDocumentsToSupabase(documents);
    } else {
      console.info("No documents to upload.");
    }

    console.info("Process completed successfully.");
  } catch (err) {
    console.error("Error during the full process:", err);
  }
}

main().catch(console.error);
