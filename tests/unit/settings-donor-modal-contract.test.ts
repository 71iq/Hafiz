import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const settingsSource = fs.readFileSync(path.join(root, "app/(tabs)/settings.tsx"), "utf8");
const stringsSource = fs.readFileSync(path.join(root, "lib/i18n/strings.ts"), "utf8");

describe("settings donor modal contract", () => {
  it("opens a local coming-soon modal instead of routing to About", () => {
    const donorRowStart = settingsSource.indexOf("title={s.settingsBecomeDonor}");
    const donorRow = settingsSource.slice(donorRowStart, donorRowStart + 320);

    expect(donorRowStart).toBeGreaterThan(-1);
    expect(donorRow).toContain("onPress={() => setDonorModalVisible(true)}");
    expect(donorRow).not.toContain('router.push("/about"');
    expect(settingsSource).toContain("const [donorModalVisible, setDonorModalVisible] = useState(false);");
    expect(settingsSource).toContain("open={donorModalVisible}");
    expect(settingsSource).toContain("s.settingsBecomeDonorModalMessage");
  });

  it("keeps donor modal copy bilingual", () => {
    expect(stringsSource).toContain(
      'settingsBecomeDonorModalMessage: "There are no donation options available right now. Support options will be added soon."'
    );
    expect(stringsSource).toContain(
      'settingsBecomeDonorModalMessage: "لا توجد خيارات دعم متاحة حاليًا. ستُضاف خيارات الدعم قريبًا."'
    );
  });
});
