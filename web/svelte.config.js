import adapter from '@sveltejs/adapter-static';

const repo = 'gym';
const base = process.env.GITHUB_PAGES === 'true' ? `/${repo}` : '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			base
		}
	}
};

export default config;
