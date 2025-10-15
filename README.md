# GitHub → PDF

Generate a clean, printable PDF "resume" from any public GitHub profile. Enter a username, preview the rendered page (including their profile README if present), and download a polished PDF with top repositories and profile details.

## Features
- Fetches GitHub user profile and repositories via the GitHub REST API
- Renders a modern resume-style page with:
  - Avatar, name, bio, followers/following, join date, and links
  - Top 10 repositories (by stars) with stars, forks, language, descriptions
  - The user's profile README (if the user has a repo named `<username>/<username>` with a README)
- One-click PDF generation using Puppeteer (A4, print backgrounds, margins)
- Optional authenticated requests via `GITHUB_TOKEN` to increase API rate limits
- Preview page with a Download button, so PDFs only download when you explicitly click

## Tech Stack
- Node.js + Express (server)
- EJS (server-side rendering)
- node-fetch (GitHub API calls)
- Puppeteer (HTML → PDF)
- marked + sanitize-html (render README.md safely)

## Prerequisites
- Node.js 18+ (recommended)
- npm

## Local Setup
1) Install dependencies:
```bash
npm install
```

2) Start the server:
```bash
npm start
```
3) Open the app:
- Visit `http://localhost:3000`
- Enter a GitHub username and click Generate
- You’ll be taken to a preview page; click "Download PDF" to download

