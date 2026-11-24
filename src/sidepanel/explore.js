// Illustrative use cases for the Explore view. These are examples of what generic selection
// capture works well for; none of them is an official integration with the named websites.
export const EXPLORE = [
  {
    title: 'Coding practice',
    sites: 'LeetCode, GeeksforGeeks, Codeforces, CodeChef, HackerRank, AtCoder',
    category: 'dsa',
    action: 'Save code',
    items: [
      'Select your accepted solution in the editor and save it. The folder is suggested from the site, for example Coding/LeetCode/.',
      'The filename comes from the problem title: "1. Two Sum" becomes two_sum.py.',
      'Add notes about your approach; they go into the commit message.',
    ],
  },
  {
    title: 'Learning and documentation',
    sites: 'MDN, Stack Overflow, official docs, technical blogs, tutorials',
    category: 'docs',
    action: 'Save documentation',
    items: [
      'Keep the paragraph that finally explained a concept, with a link back to its source.',
      'Save a code example from an answer as a runnable file.',
      'Organise by topic with tags such as async or regex.',
    ],
  },
  {
    title: 'AI and productivity',
    sites: 'Code and explanations from AI assistants, prompt libraries',
    category: 'prompt',
    action: 'Save prompt',
    items: [
      'Build a versioned prompt library in AI/Prompts/. Every edit is a commit you can compare and restore.',
      'Save generated code after reviewing it. It is never run by Git Code Port.',
      'Keep good AI explanations as Markdown notes.',
    ],
  },
  {
    title: 'Developer toolbox',
    sites: 'Linux, Git and Docker commands, SQL, JSON, YAML, regular expressions',
    category: 'commands',
    action: 'Save commands',
    items: [
      'Commands are saved in a Markdown code block under Developer-Tools/Git, Docker or Linux.',
      'SQL goes to Database/SQL, configuration files keep their real extension.',
    ],
  },
  {
    title: 'Everyday knowledge',
    sites: 'Articles, checklists, reference material, research papers',
    category: 'notes',
    action: 'Save notes',
    items: [
      'Save checklists and study notes as Markdown in Learning/Notes/.',
      'Paper abstracts with citations are suggested as Research.',
      'Find anything again later with History search.',
    ],
  },
];

export const QUICK_ACTIONS = [
  { category: 'code', label: 'Save code', hint: 'Functions, solutions, scripts' },
  { category: 'notes', label: 'Save notes', hint: 'Study notes, checklists' },
  { category: 'commands', label: 'Save commands', hint: 'Linux, Git, Docker' },
  { category: 'docs', label: 'Save documentation', hint: 'Docs and references' },
  { category: 'prompt', label: 'Save prompt', hint: 'Reusable AI prompts' },
  { category: 'resource', label: 'Save resource', hint: 'Articles, useful text' },
];
