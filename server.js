const express = require('express');
const fetch = require('node-fetch');
const ejs = require('ejs');
const marked = require('marked');
const sanitizeHtml = require('sanitize-html');
// Puppeteer v24+ is ESM-only; use dynamic import from CommonJS
let cachedPuppeteer = null;
async function getPuppeteer() {
  if (cachedPuppeteer) return cachedPuppeteer;
  const mod = await import('puppeteer');
  cachedPuppeteer = mod.default || mod;
  return cachedPuppeteer;
}
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// GitHub token for authenticated requests (optional, increases rate limit)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Serve static files (like index.html)
app.use(express.static('public'));

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/**
 * Helper function to fetch data from GitHub API
 * @param {string} url - GitHub API endpoint
 * @returns {Promise<Object>} - JSON response
 */
async function fetchGitHubData(url) {
  const headers = {
    'User-Agent': 'GitHub-to-PDF-App',
    'Accept': 'application/vnd.github.v3+json'
  };
  
  // Add authorization header if token is available
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('User not found');
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Fetch a user's profile README (if exists) and return sanitized HTML
 */
async function fetchUserReadmeHtml(username) {
  try {
    const readmeMetaUrl = `https://api.github.com/repos/${username}/${username}/readme`;
    const headers = {
      'User-Agent': 'GitHub-to-PDF-App',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const res = await fetch(readmeMetaUrl, { headers });
    if (!res.ok) return '';
    const meta = await res.json();
    if (!meta.content) return '';
    const markdown = Buffer.from(meta.content, 'base64').toString('utf8');
    const rawHtml = marked.parse(markdown);
    // Sanitize to avoid executing scripts/styles from README
    const safeHtml = sanitizeHtml(rawHtml, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'details', 'summary']),
      allowedAttributes: {
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        '*': ['id', 'class']
      },
      transformTags: {
        'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true)
      }
    });
    return safeHtml;
  } catch (_) {
    return '';
  }
}

/**
 * Fetch all data required for rendering
 */
async function buildTemplateData(username) {
  // 1. Fetch user profile data
  const userUrl = `https://api.github.com/users/${username}`;
  const userData = await fetchGitHubData(userUrl);

  // 2. Fetch user's repositories
  const reposUrl = `https://api.github.com/users/${username}/repos?per_page=100&sort=stars`;
  const reposData = await fetchGitHubData(reposUrl);

  // 3. Sort repos by stars and get top 10
  const topRepos = reposData
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 10)
    .map(repo => ({
      name: repo.name,
      description: repo.description || 'No description',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language || 'N/A',
      url: repo.html_url
    }));

  // 4. README
  const readmeHtml = await fetchUserReadmeHtml(username);

  // 5. Prepare data for template
  return {
    user: {
      login: userData.login,
      name: userData.name || userData.login,
      avatar: userData.avatar_url,
      bio: userData.bio || 'No bio available',
      company: userData.company || '',
      location: userData.location || '',
      email: userData.email || '',
      blog: userData.blog || '',
      followers: userData.followers,
      following: userData.following,
      publicRepos: userData.public_repos,
      createdAt: new Date(userData.created_at).toLocaleDateString(),
      profileUrl: userData.html_url
    },
    repos: topRepos,
    readmeHtml,
    generatedAt: new Date().toLocaleDateString()
  };
}

/**
 * HTML preview with a Download button
 * GET /preview?username=USERNAME
 */
app.get('/preview', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).send('Username parameter is required');
  try {
    const templateData = await buildTemplateData(username);
    const html = await ejs.renderFile(
      path.join(__dirname, 'views', 'template.ejs'),
      { ...templateData, showDownloadButton: true }
    );
    res.send(html);
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).send(`GitHub user "${username}" not found`);
    }
    res.status(500).send(`Error generating preview: ${error.message}`);
  }
});

/**
 * Main PDF generation endpoint
 * GET /pdf?username=USERNAME
 */
app.get('/pdf', async (req, res) => {
  const username = req.query.username;
  
  // Validate username parameter
  if (!username) {
    return res.status(400).send('Username parameter is required');
  }
  
  try {
    console.log(`Fetching data for GitHub user: ${username}`);
    const templateData = await buildTemplateData(username);

    console.log(`Rendering template for ${username}`);
    
    // 5. Render HTML from EJS template
    const html = await ejs.renderFile(
      path.join(__dirname, 'views', 'template.ejs'),
      templateData
    );
    
    console.log('Generating PDF with Puppeteer...');
    
    // 6. Launch Puppeteer and generate PDF
    const puppeteer = await getPuppeteer();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      // Set content and ensure styles render as on screen
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('screen');

      // 7. Generate PDF with custom options
      const pdfData = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
      });

      const pdfBuffer = Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);

      console.log(`PDF generated successfully for ${username}`);

      // 8. Send PDF as downloadable file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${username}-github-resume.pdf"`);
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.end(pdfBuffer);
    } finally {
      await browser.close();
    }
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    
    // Handle specific error cases
    if (error.message === 'User not found') {
      return res.status(404).send(`GitHub user "${username}" not found`);
    }
    
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`🚀 GitHub → PDF server running on http://localhost:${PORT}`);
  console.log(`📝 Visit http://localhost:${PORT} to get started`);
  if (GITHUB_TOKEN) {
    console.log('✅ GitHub token detected (higher rate limits)');
  } else {
    console.log('⚠️  No GitHub token (rate limits may apply)');
  }
});