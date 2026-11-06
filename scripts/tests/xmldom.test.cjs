const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith("/@xmldom/xmldom"));
assert.equal(copies.length, 2, "Review the XML consumer inventory before changing its scope");

for (const [name, metadata] of copies) {
  const entry = require.resolve(path.join(root, name));
  const { DOMParser, XMLSerializer } = require(entry);
  test(`XML semantic controls through ${name}`, () => {
    const source =
      '<r xmlns:p="urn:parent" label="حافظ &amp; test"><p:item id="7">A &lt; B</p:item><child xmlns:p="urn:child"><p:item/></child></r>';
    const document = new DOMParser().parseFromString(source, "application/xml");
    assert.equal(document.documentElement.getAttribute("label"), "حافظ & test");
    const nodes = document.getElementsByTagName("p:item");
    assert.equal(nodes.length, 2);
    assert.equal(nodes.item(0).namespaceURI, "urn:parent");
    assert.equal(nodes.item(1).namespaceURI, "urn:child");
    assert.equal(nodes.item(0).textContent, "A < B");
    assert.equal(new XMLSerializer().serializeToString(document), source);
    const manifest = new DOMParser().parseFromString(
      fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8"),
      "application/xml",
    );
    assert.equal(manifest.documentElement.tagName, "manifest");
    assert.ok(manifest.getElementsByTagName("application").length > 0);
  });
  test(`XML inherited namespace correctness through ${name}`, () => {
    const count = 512;
    const source =
      Array.from({ length: count }, (_, i) => `<a xmlns:p${i}="urn:${i}">`).join("") +
      "<p0:leaf/>" +
      "</a>".repeat(count);
    const document = new DOMParser().parseFromString(source, "application/xml");
    assert.equal(document.getElementsByTagName("p0:leaf").item(0).namespaceURI, "urn:0");
    assert.equal(new XMLSerializer().serializeToString(document), source);
  });
  test(`XML malformed end-tag recovery remains bounded through ${name}`, () => {
    const code = `const {DOMParser}=require(process.argv[1]);const parser=new DOMParser(process.argv[2]==='8'?{errorHandler:{warning(){},error(){},fatalError(){}}}:{onError(){}});const input='<r></'+' '.repeat(1024*1024)+'x>';try {parser.parseFromString(input,'application/xml');} catch {} process.stdout.write('completed');`;
    const child = spawnSync(
      process.execPath,
      ["--max-old-space-size=128", "-e", code, entry, metadata.version.split(".")[1]],
      { encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
    );
    assert.equal(child.error, undefined, `${name}: ${child.error?.message}`);
    assert.equal(child.status, 0, `${name}: ${child.stderr}`);
    assert.equal(child.stdout, "completed");
  });
  test(`XML malformed tag recovery avoids repeated scans through ${name}`, () => {
    const code = `const assert=require('node:assert/strict');const {DOMParser}=require(process.argv[1]);const parser=new DOMParser(process.argv[2]==='8'?{errorHandler:{warning(){},error(){},fatalError(){}}}:{onError(){}});const source='<r>'+'<'.repeat(512)+'></r>';let scans=0;const charAt=String.prototype.charAt;let document;try{String.prototype.charAt=function(index){if(this.length===source.length)scans++;return charAt.call(this,index);};document=parser.parseFromString(source,'application/xml');}finally{String.prototype.charAt=charAt;}assert.equal(document.documentElement.textContent,'<'.repeat(512)+'>');assert.ok(scans<=source.length*4,'Excessive recovery scan work: '+scans);process.stdout.write('completed');`;
    const child = spawnSync(
      process.execPath,
      ["--max-old-space-size=128", "-e", code, entry, metadata.version.split(".")[1]],
      { encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
    );
    assert.equal(child.error, undefined, `${name}: ${child.error?.message}`);
    assert.equal(child.status, 0, `${name}: ${child.stderr}`);
    assert.equal(child.stdout, "completed");
  });
  test(`XML normalization merges adjacent text in one bounded pass through ${name}`, () => {
    const code = `const assert=require('node:assert/strict');const {DOMParser}=require(process.argv[1]);const document=new DOMParser().parseFromString('<r><before/><!--keep--></r>','application/xml');const root=document.documentElement;const first=document.createTextNode('ح');root.appendChild(first);for(let i=1;i<512;i++)root.appendChild(document.createTextNode('ح'));let copies=0;const append=first.appendData;first.appendData=function(text){copies+=this.data.length+text.length;return append.call(this,text);};try{root.normalize();}finally{delete first.appendData;}assert.equal(root.lastChild,first);assert.equal(first.data,'ح'.repeat(512));assert.equal(root.childNodes.length,3);assert.equal(root.firstChild.tagName,'before');assert.equal(root.childNodes.item(1).data,'keep');assert.ok(copies<=1024,'Excessive normalization copy work: '+copies);process.stdout.write('completed');`;
    const child = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", code, entry], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4096,
    });
    assert.equal(child.error, undefined, `${name}: ${child.error?.message}`);
    assert.equal(child.status, 0, `${name}: ${child.stderr}`);
    assert.equal(child.stdout, "completed");
  });
  test(`XML installed instance agrees with its reviewed lock at ${name}`, () => {
    const actual = JSON.parse(fs.readFileSync(path.join(root, name, "package.json"), "utf8"));
    assert.equal(actual.version, metadata.version);
    assert.equal(actual.version, name === "node_modules/@xmldom/xmldom" ? "0.8.15" : "0.9.12");
  });
}
test("Expo plist consumer preserves its actual parse/build contract", () => {
  const expo = createRequire(require.resolve("expo/package.json"));
  const plist = expo("@expo/plist").default;
  const owner = createRequire(expo.resolve("@expo/plist"));
  const value = { CFBundleName: "Hafiz", nested: { title: "حافظ & text", enabled: true }, list: [1, "two", false] };
  const expected = Object.assign(Object.create(null), {
    ...value,
    nested: Object.assign(Object.create(null), value.nested),
  });
  assert.deepEqual(plist.parse(plist.build(value)), expected);
  assert.equal(owner("@xmldom/xmldom/package.json").version, "0.8.15");
});
