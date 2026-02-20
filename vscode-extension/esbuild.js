const esbuild = require("esbuild");
const isWatch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs", // VSCode Extension Host requires CJS
    external: ["vscode"], // vscode is provided by VSCode, do not bundle
    outfile: "dist/extension.js",
    sourcemap: true,
    minify: !isWatch,
  });

  if (isWatch) {
    await ctx.watch();
    console.log("Watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
