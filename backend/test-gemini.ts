import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function testGemini() {
  console.log('Testing Gemini API with key:', process.env.GEMINI_API_KEY?.substring(0, 10) + '...');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
  try {
    const result = await Promise.race([
      model.generateContent('Hello! Tell me a joke.'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 30s')), 30000))
    ]) as any;
    console.log('Success:', result.response.text());
  } catch (err: any) {
    console.error('Gemini Error:', err.message);
  }
}

testGemini();
