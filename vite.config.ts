import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"), //
    },
  },
  build: {
    rollupOptions: {
      external: [
        // 排除 src/ignore-dir 目录（支持正则）
        /src\/ignore-dir\/.*/,
        // 排除单个文件
        "src/views/E2eeCompleteTest2.vue",
        "src/views/E2eeCompleteTest2.vue",
        "/src/views/E2eeTestPage.vue",
        "/src/views/FileTestPage.vue",
        "/src/views/GroupChatTest.vue",
        "/src/views/MockChatTest.vue",
      ],
    },
  },
  // server: {
  //   proxy: {
  //     "/api": {
  //       target: "http://113.54.161.38:9090",
  //       changeOrigin: true,
  //       rewrite: (path) => path.replace(/^\/api/, ""),
  //     },
  //   },
  // },
  // "build": "vue-tsc -b && vite build",
});
