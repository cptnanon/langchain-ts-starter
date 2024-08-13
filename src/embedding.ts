import { createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import { GotenksPosts } from "./data/gotenks-posts.ts";
import { StaniPosts } from "./data/stani-posts.ts";
import { chaoticMonkPosts } from "./data/chaoticmonk-posts.ts";

try {
  const documents: Document<Record<string, any>>[] = chaoticMonkPosts.map(
    (post) => {
      return {
        pageContent: post.content || " ",
        metadata: {
          publication_id: post.publication_id,
          main_content_focus: post.main_content_focus,
          author: "chaoticmonk",
          timestamp: post.timestamp,
        },
      };
    }
  );

  console.log(`Number of documents: ${documents.length}`);
  documents.slice(0, 2).forEach((doc) => {
    console.log(doc);
    console.log(doc.metadata);
  });

  const sbApiKey = process.env.SUPABASE_API_KEY;
  const sbUrl = process.env.SUPABASE_URL;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  if (!sbApiKey || !sbUrl || !openAIApiKey) {
    throw new Error("Missing environment variables");
  }

  const client = createClient(sbUrl, sbApiKey);

  console.info("Indexing documents...");

  await SupabaseVectorStore.fromDocuments(
    documents,
    new OpenAIEmbeddings({ openAIApiKey }),
    {
      client,
      tableName: "documents",
    }
  );

  console.info("Documents indexed successfully");
} catch (err) {
  console.log(err);
}
