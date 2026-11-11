// Electron'un exe dosyasına uygulama simgesini ve sürüm bilgisini yazar (Windows gerektirmez).
// Kullanım: node set-exe-meta.mjs <exe> <icon.ico> <sürüm>
import fs from 'fs';
import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';
const [, , exePath, icoPath, version] = process.argv;
const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const v = (version + '.0.0.0').split('.').slice(0, 4).map(n => +n || 0);
vi.setFileVersion(...v, 1033); vi.setProductVersion(...v, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'K1 Max Dilimleyici', ProductName: 'K1 Max Dilimleyici', CompanyName: 'thecemozen',
  OriginalFilename: 'K1MaxDilimleyici.exe', InternalName: 'K1MaxDilimleyici', LegalCopyright: 'AGPL-3.0',
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('exe simgesi ve sürüm bilgisi yazıldı:', version);
