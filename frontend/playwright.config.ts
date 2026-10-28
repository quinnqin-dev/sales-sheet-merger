import { defineConfig, chromium } from "@playwright/test";
export default defineConfig({
  reporter: [["list"],["json",{outputFile:"../docs/verification/browser-results.json"}]],
  testDir:"./browser-tests", timeout:180000, expect:{timeout:15000}, workers:1,
  use:{baseURL:"http://127.0.0.1:4178", viewport:{width:1440,height:1000}, trace:"retain-on-failure"},
  projects:[
    {name:"chromium",use:{browserName:"chromium",launchOptions:{executablePath:chromium.executablePath()}}},
    {name:"firefox",use:{browserName:"firefox"}},
    {name:"webkit",use:{browserName:"webkit"}},
  ],
  webServer:{command:"npm run build && npm run preview -- --host 127.0.0.1 --port 4178 --strictPort",url:"http://127.0.0.1:4178",reuseExistingServer:!process.env.CI},
});
