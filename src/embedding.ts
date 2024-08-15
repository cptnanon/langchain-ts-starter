import { BigQuery } from "@google-cloud/bigquery";
import { createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";

const profileMapping: { [key: string]: string } = {
  "0x0161e2": "ruthless",
  "0x013cee": "gotenks",
  "0x05": "stani",
  "0x8e": "christina",
  "0x01cdb0": "yakuza",
  "0x89dc": "chaoticmonk",
  "0x0f85": "punkess",
};

async function fetchAndIndexPosts(profileId: string) {
  const username = profileMapping[profileId];
  try {
    console.info(`Starting processing for ${username} (${profileId})...`);

    // Initialize BigQuery client
    const bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: JSON.parse(process.env.GCP_KEYFILE || ""),
    });

    // Define your BigQuery SQL query, fetching data until yesterday with content longer than 70 characters
    const query = `
            SELECT pr.publication_id, pm.content, pm.main_content_focus, pr.publication_type, pr.parent_publication_id, pm.timestamp
            FROM \`lens-public-data.v2_polygon.publication_record\` pr
            JOIN \`lens-public-data.v2_polygon.publication_metadata\` pm
            ON pr.publication_id = pm.publication_id
            WHERE pr.profile_id = "${profileId}" 
            AND pr.publication_type != "MIRROR" 
            AND pr.is_hidden = false 
            AND LENGTH(pm.content) > 70
        `;

    console.info(`Executing BigQuery for ${username} (${profileId})...`);
    const [rows] = await bigquery.query({ query });
    console.info(
      `Query executed. Fetched ${rows.length} rows for ${username} (${profileId}).`
    );

    if (rows.length === 0) {
      console.info(`No documents to index for ${username} (${profileId}).`);
      return 0;
    }

    // Process documents
    const documents: Document<Record<string, any>>[] = rows.map((post) => {
      return {
        pageContent: post.content || " ",
        metadata: {
          publication_id: post.publication_id,
          main_content_focus: post.main_content_focus,
          author: username, // Use mapped username
          publication_type: post.publication_type,
          parent_publication_id: post.parent_publication_id,
          content_type: post.content_type,
          timestamp: post.timestamp,
        },
      };
    });

    console.info(
      `Number of documents prepared for indexing for ${username} (${profileId}): ${documents.length}`
    );

    const sbApiKey = process.env.SUPABASE_API_KEY;
    const sbUrl = process.env.SUPABASE_URL;
    const openAIApiKey = process.env.OPENAI_API_KEY;
    if (!sbApiKey || !sbUrl || !openAIApiKey) {
      throw new Error("Missing environment variables");
    }

    const client = createClient(sbUrl, sbApiKey);

    console.info(`Indexing documents for ${username} (${profileId})...`);
    await SupabaseVectorStore.fromDocuments(
      documents,
      new OpenAIEmbeddings({ openAIApiKey }),
      {
        client,
        tableName: "documents",
      }
    );

    console.info(
      `Documents indexed successfully for ${username} (${profileId}).`
    );
    return documents.length;
  } catch (err) {
    console.error(`Error processing ${username} (${profileId}):`, err);
    return 0;
  }
}

async function main() {
  console.info("Starting the indexing process for all profiles...");
  const profiles = Object.keys(profileMapping); // Get all profile IDs from the mapping
  let totalDocumentsIndexed = 0;

  for (const profileId of profiles) {
    const count = await fetchAndIndexPosts(profileId);
    console.info(
      `Indexed ${count} documents for ${profileMapping[profileId]} (${profileId}).`
    );
    totalDocumentsIndexed += count;
  }

  console.info(
    `Total documents indexed across all profiles: ${totalDocumentsIndexed}`
  );
}

main().catch(console.error);
