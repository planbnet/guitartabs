import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("js/vendor/basic-pitch-model", { recursive: true });
copyFileSync(
  "node_modules/@spotify/basic-pitch/model/model.json",
  "js/vendor/basic-pitch-model/model.json"
);
copyFileSync(
  "node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin",
  "js/vendor/basic-pitch-model/group1-shard1of1.bin"
);
copyFileSync(
  "node_modules/@spotify/basic-pitch/LICENSE",
  "js/vendor/BASIC_PITCH_LICENSE.txt"
);

