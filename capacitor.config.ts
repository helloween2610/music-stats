import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.minlab.musicstats",
  appName: "Sổ Nghe Nhạc",
  webDir: "dist-ios",
  server: {
    iosScheme: "capacitor",
  },
};

export default config;
