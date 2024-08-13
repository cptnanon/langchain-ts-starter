import "cheerio"; // This is required in notebooks to use the `CheerioWebBaseLoader`
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableMap, RunnablePassthrough } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { z } from "zod";

const llm = new ChatOpenAI({
  model: "gpt-3.5-turbo",
  temperature: 0,
});

const loader = new CheerioWebBaseLoader(
  "https://en.wikipedia.org/wiki/Heidelberg"
);

const docs = await loader.load();

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
const documents = await splitter.splitDocuments(docs);
const vectorStore = await MemoryVectorStore.fromDocuments(
  documents,
  new OpenAIEmbeddings()
);
const retriever = vectorStore.asRetriever();

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You're a helpful AI assistant. Given a user question and some web article snippets, answer the user question. If none of the articles answer the question, just say you don't know.\n\nHere are the web articles:{context}",
  ],
  ["human", "{question}"],
]);

const formatDocs = (input: Record<string, any>): string => {
  const { docs } = input;
  return (
    "\n\n" +
    docs
      .map(
        (doc: Document) =>
          `Article Source: ${doc.metadata.source}\nArticle Snippet: ${doc.pageContent}`
      )
      .join("\n-------------------------------------\n")
  );
};

const formatDocsWithId = (docs: Array<Document>): string => {
  return (
    "\n\n" +
    docs
      .map(
        (doc: Document, idx: number) =>
          `Source ID: ${idx}\nArticle title: ${doc.metadata.source}\nArticle Snippet: ${doc.pageContent}`
      )
      .join("\n-------------------------------------\n")
  );
};

const answerChain = prompt.pipe(llm).pipe(new StringOutputParser());

const map = RunnableMap.from({
  question: new RunnablePassthrough(),
  docs: retriever,
});

const chain = map
  .assign({ context: formatDocs })
  .assign({ answer: answerChain })
  .pick(["answer", "docs"]);

const llmWithTool1 = llm.withStructuredOutput(
  z
    .object({
      answer: z
        .string()
        .describe(
          "The answer to the user question, which is based only on the given sources."
        ),
      citations: z
        .array(z.number())
        .describe(
          "The integer IDs of the SPECIFIC sources which justify the answer."
        ),
    })
    .describe("A cited source from the given text"),
  {
    name: "cited_answers",
  }
);

const answerChainWithTool = prompt.pipe(llmWithTool1);
const mapWithTool = RunnableMap.from({
  question: new RunnablePassthrough(),
  docs: retriever,
});

const chainWithTool = mapWithTool
  .assign({
    context: (input: { docs: Array<Document> }) => formatDocsWithId(input.docs),
  })
  .assign({
    cited_answer: answerChainWithTool,
  })
  .assign({
    answer: (input: { cited_answer: { answer: string } }) =>
      input.cited_answer.answer,
  })
  .pick(["cited_answer", "answer", "docs"]);

const stream = await chainWithTool.stream("who is the mayor of heidelberg");

for await (const chunk of stream) {
  console.log(chunk);
}
