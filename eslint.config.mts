import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/no-this-alias": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"obsidianmd/no-static-styles-assignment": "off",
			"obsidianmd/no-forbidden-elements": "off",
			"obsidianmd/ui/sentence-case": "off",
			"obsidianmd/settings-tab/no-manual-html-headings": "off",
			"obsidianmd/detach-leaves": "off",
			"no-console": ["error", { allow: ["warn", "error", "debug", "log"] }],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"release",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
