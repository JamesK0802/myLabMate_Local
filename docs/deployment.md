# Static Deployment Guide

Because **CRISPR Local** runs 100% client-side in the browser, it requires no backend servers, database connectors, or cloud APIs. The entire application compiles down to lightweight, standard static web files (`HTML`, `JS`, `CSS`, and image assets) that can be hosted on any static platform.

---

## Compilation (Production Build)

Compile the optimized static build on your local computer:

```bash
# 1. Install dependencies
npm install

# 2. Compile static assets
npm run build
```

This generates the static distribution bundle inside:
**`dist/crispr-local-web/browser/`**

---

## Host Deployment Instructions

Choose your hosting platform and follow the steps below to upload the compiled `dist/crispr-local-web/browser/` folder:

### 1. GitHub Pages
Since GitHub Pages hosts project sites under subfolders (e.g., `https://<username>.github.io/<repository-name>/`), configure the base href when compiling so that assets load from the correct directory:

```bash
# Replace <repository-name> with your actual GitHub repository name (e.g., crispr-local-web)
npx ng build --configuration production --base-href /<repository-name>/
```

Once built:
1. Push the contents of the `dist/crispr-local-web/browser` folder to a branch (e.g., `gh-pages`) in your repository.
2. In your repository settings on GitHub, navigate to **Pages**.
3. Under **Build and deployment**, choose the source branch (`gh-pages`) and path (`/ (root)`).
4. Save and wait for the GitHub Pages deployment runner to complete.

### 2. Cloudflare Pages
1. Log in to the Cloudflare Dashboard and navigate to **Workers & Pages**.
2. Click **Create Application** -> **Pages** -> **Upload assets**.
3. Create a project name (e.g., `crispr-local`).
4. Drag and drop the folder `dist/crispr-local-web/browser` to upload.
5. Click **Deploy site**.

### 3. Netlify
- **Drag-and-Drop Method**:
  1. Go to the [Netlify App](https://app.netlify.com/).
  2. Drag the `dist/crispr-local-web/browser` folder directly into the deploy box on the Netlify dashboard.
- **CLI Method**:
  ```bash
  npm install netlify-cli -g
  netlify deploy --dir=dist/crispr-local-web/browser --prod
  ```

### 4. Vercel
1. Install the Vercel CLI or link your Git repository to Vercel.
2. If using Vercel CLI, deploy the directory:
   ```bash
   npm install -g vercel
   vercel --prod --name crispr-local dist/crispr-local-web/browser
   ```

### 5. Custom Web Server (Nginx / Apache / Amazon S3)
Copy the contents of `dist/crispr-local-web/browser` directly into the document root of your web server.

**Example Nginx Server Block:**
```nginx
server {
    listen 80;
    server_name crispr-local.yourdomain.com;

    location / {
        root /var/www/crispr-local-web;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Local Static Verification

You can test the production build locally before uploading it to a hosting provider using a simple server like `npx http-server`:

```bash
npx http-server dist/crispr-local-web/browser -p 8080
```
Then visit **[http://localhost:8080](http://localhost:8080)**.
