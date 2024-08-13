import readlineSync from "readline-sync";
import wrapAnsi from "wrap-ansi";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { retriever } from "./retriever.ts";
import { Document } from "langchain/document";

const answerTemplate = `"You are an assistant for question-answering tasks. You will provide insights into the posts and comments made by a user named Gotenks. These posts were made on a social media platform called Lens which is using a social graph that is stored on the polygon blockchain. Use the following pieces of retrieved context to answer the question. You will have information about the the post content, a post id, the content type, and the timestamp of the post. Only use the posts that are relevant to the users question. Answer in an engaging and humorous way.

If you don't know the answer, just say that you don't know. Please do not make up the answer.
If the content is of type Image or other media, mention in your answer that it's a caption for the image.
At the end of each message share the publication of the posts as a list of sources.

Do not do any other task other than answering the questions about gotenks. ALWAYS answer out of the context or the chat history.

ALWAYS add a new line after each sentence to make the answer more readable.

---------------------------------------------------
Question: {question} 
---------------------------------------------------
Context: {context}
---------------------------------------------------
Answer: 
"`;

const answerPrompt = PromptTemplate.fromTemplate(answerTemplate);

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

const formatDocs = (docs: Document[]) => {
  return docs
    .map((doc) => {
      const metadata = doc.metadata;
      return `ID: ${metadata.publication_id}\nContent Type: ${metadata.main_content_focus}\nTimestamp: ${metadata.timestamp}\n\nContent: ${doc.pageContent}`;
    })
    .join("\n\n#####################\n\n");
};

const retrieverChain = RunnableSequence.from([
  (prevResult) => prevResult,
  retriever,
  formatDocs,
]);

const wrapText = (text: string, width: number = 80) => {
  return wrapAnsi(text, width, { hard: true });
};

const answerChain = answerPrompt.pipe(llm).pipe(new StringOutputParser());

const chain = RunnableSequence.from([
  {
    question: new RunnablePassthrough(),
    context: retrieverChain,
  },
  answerChain,
]);

const main = async () => {
  console.clear();
  console.log(
    "Welcome to the terminal chat! Type your questions about Gotenks below.\n"
  );

  let history: { question: string; answer: string }[] = [];

  while (true) {
    const userInput = readlineSync.question("You: ");

    // Exit chat on specific input
    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      console.log("Goodbye!");
      break;
    }

    // Process the user input
    try {
      const response = await chain.invoke(userInput);
      const wrappedResponse = wrapText(`Assistant:\n ${response}\n`, 80);
      console.log(wrappedResponse);
      //console.log(`Assistant:\n ${response}`);

      // Save to history
      history.push({ question: userInput, answer: response });
    } catch (err) {
      console.error("Error processing your question:", err);
    }
  }

  // Optionally, save the conversation history to a file or database
  // fs.writeFileSync('chat_history.json', JSON.stringify(history, null, 2));
};

main();
