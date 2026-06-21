import { readFileSync } from 'fs';

const resumePdfBase64 = readFileSync('./Samarpartap_Passey.pdf').toString('base64');

const jobDescription = `At Leap Tools, we are building the world's most advanced solutions for the interior décor industry. With customers in 80+ countries, our clientele includes Fortune 500 companies such as Home Depot, local retailers such as Alexanian's, and everything in between. We have been recognized as one of the fastest-growing tech companies by Deloitte for multiple years in a row, and we are looking for ambitious challenge-seekers to fuel our momentum and help us create an iconic global tech company.

About our product
Our technology lets you preview products in your own room before you buy them. Imagine you want to redesign your home and have been searching for new tiles for your kitchen, or a new rug for your living room. You definitely want to make sure it will look good in your space. We enable you to do that through our proprietary cutting-edge technology, presented in an extraordinarily simple and accessible way. Try our rug demo now! Simply upload a picture of your room using your mobile phone, and slide the rug under your coffee table: https://www.roomvo.com/rugdemo...

About you
You have a passion for solving complex problems and working on products used by millions of people. You enjoy setting the bar high and clearing it. You can lead by example, but you know when to step aside and let the team run with the ball. Your technical knowledge is matched only by your passion to design, create, and succeed with others.
You want to build on your experience. You are interested in making a big impact, but perhaps you are currently limited in your growth potential. Join us and you will work directly with our talented engineering team to push our product to new heights.

We hire humans, not job descriptions. You should apply even if this role and salary range don't align with your experience. We’re happy to create unique roles and compensation for the right talent.

About our Stack
TypeScript, Next.js, React/Redux, Three.js
Python, Django, PostgreSQL, AWS

What You'll Do
Leverage cutting-edge computer vision technology to launch visually stunning 3D experiences for clients in the home decor industry.
Work closely with product, design and other stakeholders to build the right solutions for our customers.
Design and implement scalable, maintainable, high-performance front-end solutions, ensuring an exceptional user experience.
Own key systems and components, driving their development, deployment, operation, and continuous improvement.
Unblock, support and communicate with internal and external partners to achieve results.
Learn and develop your skill sets alongside your peers and mentors.

We’re looking for someone with
At least 1 year of experience
Strong computer science fundamentals based on a degree in computer science or distinctive work experience in software development.
Comfortable with both front-end and back-end development.
Strong focus on execution and delivery of the product
Exceptional attention to detail and focus on quality and long-term goals
Strong communication skills 
Comfortable interacting with senior management, project stakeholders, and other development teams.
Comfortable working in a fast-paced, evolving environment where learning and adaptability are key.
Familiarity with the stack is strongly preferred but not required.

About our culture
We're a remote-first company that encourages our employees to work from where they're most productive.
We work in tight-knit teams to cultivate an ownership mentality.
We cherish curiosity and an obsession for details because we know these details are invaluable over the long run.
We're hyper-focused on our achievements and our ability to execute our promises. We act with urgency.
Work anywhere in the world for up to 3 months!
We value families, by offering a parental leave program
We offer a work-from-home stipend
Your birthday (and our company's birthday) is a day off!

About our hiring process
Now: You upload your resume and complete a brief questionnaire.
Step 1: We arrange a video call with you to assess your technical abilities.
Step 2: You attend the second video interview soon after.
Step 3: Culture fit assessment.
Step 4: Final interview with leadership.
Step 5: You receive an offer.

AI in Recruitment - At Leap Tools, we leverage AI technology to enhance our recruitment process. These tools assist with tasks such as resume screening, sourcing prospective candidates, and to support administrative tasks for enhanced operational efficiency. Founders and senior leadership are directly involved in our recruitment process, and AI is never used to make the final hiring decision. We are committed to the responsible use of AI in our hiring practices.

Expected salary range, Ontario based: $65,000 - $115,000 + other benefits.
We value exceptional talent above all else. If your expectations or seniority sit outside the stated range, you should still apply. We can scale roles and compensation to match your unique situation.

This is a net new position on the team.

Leap Tools is an equal opportunity employer committed to fostering an inclusive, equitable, and accessible environment. Accommodations are available on request for candidates taking part in all aspects of the interview process. If you require any accommodation, please contact us at ta@leaptools.com

Take the Leap. Apply now.
Our demo, in case you missed it: https://www.roomvo.com/rugdemo4r

You should apply to this job even if you don't fit this role perfectly because we can create a new role for you with corresponding compensation.`;

const roundType = 'technical';

const res = await fetch('http://localhost:3000/api/realtime/initialize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumePdfBase64, jobDescription, roundType }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));