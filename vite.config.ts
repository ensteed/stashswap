import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
    build: {
        outDir: "public",
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
            input: path.resolve(__dirname, "src/client/main.ts"),
        },
    },
});
