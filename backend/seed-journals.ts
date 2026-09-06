import { auth, db } from './src/utils/firebase.js';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

const sampleJournals = [
  {
    title: "A Productive Monday",
    summary: "Started the week with a lot of energy. Managed to finish the big presentation and had a great brainstorming session with the team.",
    keywords: ["productivity", "presentation", "teamwork"],
    themes: ["Work", "Energy"],
    includeInThoughtMap: true,
    modelVersion: "gemini-3.8-flash",
  },
  {
    title: "Mid-week Slump",
    summary: "Felt a bit drained today. Didn't get as much done as I wanted, but I took a nice long walk in the evening which helped clear my head.",
    keywords: ["tired", "walk", "mental health"],
    themes: ["Health", "Energy", "Work"],
    includeInThoughtMap: true,
    modelVersion: "gemini-3.8-flash",
  },
  {
    title: "Weekend Planning",
    summary: "Looking forward to the weekend. Planning to finally start that new book and maybe try out a new recipe. Work went smoothly today.",
    keywords: ["weekend", "reading", "cooking"],
    themes: ["Leisure", "Planning"],
    includeInThoughtMap: true,
    modelVersion: "gemini-3.8-flash",
  },
  {
    title: "Project Milestone Reached",
    summary: "We finally hit the major milestone on the new project! It feels incredibly rewarding after weeks of hard work. Celebrated with the team.",
    keywords: ["milestone", "celebration", "project"],
    themes: ["Work", "Achievement"],
    includeInThoughtMap: true,
    modelVersion: "gemini-3.8-flash",
  }
];

async function seed() {
  try {
    console.log("Fetching users...");
    const userRecords = await auth.listUsers(10);
    const users = userRecords.users;
    
    if (users.length === 0) {
      console.log("No users found in Firebase Auth. Please log in to the frontend first.");
      process.exit(1);
    }
    
    // Seed for all users found (usually just 1 for local testing)
    for (const user of users) {
      console.log(`Seeding journals for user: ${user.uid} (${user.email})`);
      
      const journalsRef = db.collection('users').doc(user.uid).collection('journals');
      
      for (const [index, journal] of sampleJournals.entries()) {
        // Spread dates out over the last few days
        const date = new Date();
        date.setDate(date.getDate() - (sampleJournals.length - index));
        
        const now = Timestamp.fromDate(date);
        
        await journalsRef.add({
          ...journal,
          sourceConversationId: randomUUID(),
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1
        });
      }
      console.log(`Successfully added ${sampleJournals.length} sample journals for user ${user.email}`);
    }
    
    console.log("Done seeding!");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding journals:", error);
    process.exit(1);
  }
}

seed();
