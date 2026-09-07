const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
async function run() {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro-latest', 'gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];
  for (const model of models) {
    try {
      const m = genAI.getGenerativeModel({ model: model });
      await m.generateContent("test");
      console.log(model + " is WORKING");
    } catch (e) {
      console.log(model + " FAILED: " + e.message);
    }
  }
}
run();
