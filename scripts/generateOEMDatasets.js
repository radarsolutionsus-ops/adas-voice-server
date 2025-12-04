/**
 * Generate Derived OEM Datasets
 *
 * This script generates derived JSON files from the raw OEM knowledge data:
 * - target_specs.json
 * - prerequisites.json
 * - quirks.json
 * - blockerDTCs_from_dataset.json
 * - adas_equipment_providers.json
 * - knowledge_base_index.json
 *
 * Run with: node scripts/generateOEMDatasets.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import OEM modules
import * as loader from '../utils/oem/loader.js';
import * as parser from '../utils/oem/parser.js';

const ADAS_OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'oem_knowledge', 'ADAS');
const EQUIPMENT_OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'oem_knowledge', 'Equipment');
const METADATA_OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'oem_knowledge', 'Metadata');

console.log('Generating derived OEM datasets...\n');

// Ensure directories exist
for (const dir of [ADAS_OUTPUT_DIR, EQUIPMENT_OUTPUT_DIR, METADATA_OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

// 1. Generate target_specs.json
console.log('1. Generating target_specs.json...');
const targetSpecs = parser.extractTargetDimensions();
const targetSpecsData = {
  metadata: {
    name: 'ADAS Target Specifications',
    description: 'Target board dimensions and placement requirements by brand',
    generated: new Date().toISOString(),
    version: '1.0'
  },
  brands: targetSpecs
};
fs.writeFileSync(
  path.join(ADAS_OUTPUT_DIR, 'target_specs.json'),
  JSON.stringify(targetSpecsData, null, 2)
);
console.log(`   - ${Object.keys(targetSpecs).length} brands with target specs`);

// 2. Generate prerequisites.json
console.log('2. Generating prerequisites.json...');
const prerequisites = parser.extractPrerequisites();
const prerequisitesData = {
  metadata: {
    name: 'ADAS Calibration Prerequisites',
    description: 'Pre-calibration requirements by brand',
    generated: new Date().toISOString(),
    version: '1.0'
  },
  brands: prerequisites
};
fs.writeFileSync(
  path.join(ADAS_OUTPUT_DIR, 'prerequisites.json'),
  JSON.stringify(prerequisitesData, null, 2)
);
console.log(`   - ${Object.keys(prerequisites).length} brands with prerequisites`);

// 3. Generate quirks.json
console.log('3. Generating quirks.json...');
const quirks = parser.extractQuirks();
const quirksData = {
  metadata: {
    name: 'ADAS Brand Quirks',
    description: 'Critical brand-specific issues and notes',
    generated: new Date().toISOString(),
    version: '1.0'
  },
  brands: quirks
};
fs.writeFileSync(
  path.join(ADAS_OUTPUT_DIR, 'quirks.json'),
  JSON.stringify(quirksData, null, 2)
);
console.log(`   - ${Object.keys(quirks).length} brands with quirks`);

// 4. Generate blockerDTCs_from_dataset.json
console.log('4. Generating blockerDTCs_from_dataset.json...');
const calibrations = loader.loadADASCalibrationDataset();
const dtcBlockers = {};
for (const cal of calibrations) {
  const brand = parser.normalizeBrand(cal.brand);
  if (!dtcBlockers[brand]) {
    dtcBlockers[brand] = {};
  }
  if (cal.dtc_blockers && cal.dtc_blockers !== 'None' && cal.dtc_blockers !== 'None typically') {
    dtcBlockers[brand][cal.system_type] = cal.dtc_blockers;
  }
}
const dtcBlockersData = {
  metadata: {
    name: 'DTC Blockers for ADAS Calibration',
    description: 'DTCs that prevent calibration from completing by brand and system',
    generated: new Date().toISOString(),
    version: '1.0'
  },
  brands: dtcBlockers
};
fs.writeFileSync(
  path.join(ADAS_OUTPUT_DIR, 'blockerDTCs_from_dataset.json'),
  JSON.stringify(dtcBlockersData, null, 2)
);
console.log(`   - ${Object.keys(dtcBlockers).length} brands with DTC blocker info`);

// 5. Generate adas_equipment_providers.json
console.log('5. Generating adas_equipment_providers.json...');
const equipment = loader.loadADAS_EquipmentProviders();
const thirdPartyData = loader.loadThirdPartyPlatforms();
const equipmentData = {
  metadata: {
    name: 'ADAS Equipment Providers',
    description: 'ADAS calibration equipment manufacturers and capabilities',
    generated: new Date().toISOString(),
    version: '1.0'
  },
  providers: equipment.map(e => ({
    manufacturer: e.manufacturer,
    code: e.equipment_code,
    entryCost: e.entry_cost,
    fullSystemCost: e.full_system_cost,
    oemApprovals: e.oem_approvals?.split(';').map(a => a.trim()).filter(a => a) || [],
    coverage: e.coverage_percent,
    strengths: e.strengths?.split(';').map(s => s.trim()).filter(s => s) || [],
    targetSystem: e.target_system,
    softwareUpdates: e.software_updates,
    notes: e.notes
  })),
  additionalFromThirdParty: thirdPartyData?.adas_equipment_platforms || []
};
fs.writeFileSync(
  path.join(EQUIPMENT_OUTPUT_DIR, 'adas_equipment_providers.json'),
  JSON.stringify(equipmentData, null, 2)
);
console.log(`   - ${equipment.length} equipment providers`);

// 6. Generate knowledge_base_index.json
console.log('6. Generating knowledge_base_index.json...');
const oemMaster = loader.loadOEMMasterTable();
const legalData = loader.loadLegalDataset();

// Get all brands
const allBrands = new Set();
if (oemMaster?.oem_portals) {
  oemMaster.oem_portals.forEach(p => allBrands.add(p.brand));
}
calibrations.forEach(c => allBrands.add(parser.normalizeBrand(c.brand)));

// Get all systems
const allSystems = new Set();
calibrations.forEach(c => {
  if (c.system_type) allSystems.add(c.system_type);
  if (c.system_code) allSystems.add(c.system_code);
});

// Get calibration methods
const calibrationMethods = {
  static: [],
  dynamic: [],
  selfCalibrating: []
};
for (const cal of calibrations) {
  const brand = parser.normalizeBrand(cal.brand);
  if (cal.static_calibration?.toLowerCase() === 'yes') {
    if (!calibrationMethods.static.includes(brand)) {
      calibrationMethods.static.push(brand);
    }
  }
  if (cal.dynamic_calibration?.toLowerCase() === 'yes') {
    if (!calibrationMethods.dynamic.includes(brand)) {
      calibrationMethods.dynamic.push(brand);
    }
  }
  if (cal.static_calibration?.toLowerCase().includes('self') ||
      cal.dynamic_calibration?.toLowerCase().includes('self') ||
      cal.special_quirks?.toLowerCase().includes('self-calibrat')) {
    if (!calibrationMethods.selfCalibrating.includes(brand)) {
      calibrationMethods.selfCalibrating.push(brand);
    }
  }
}

// Get third-party support summary
const thirdPartySummary = {};
if (thirdPartyData?.platforms) {
  for (const platform of thirdPartyData.platforms) {
    thirdPartySummary[platform.name] = {
      code: platform.code,
      category: platform.category,
      adasQuality: platform.adas_quality,
      coverage: platform.coverage?.vehicles || 'Various'
    };
  }
}

// Get legal access levels
const legalAccessSummary = {};
for (const row of legalData) {
  const brand = parser.normalizeBrand(row.oem);
  legalAccessSummary[brand] = {
    nastfRequired: row.nastf_required?.toLowerCase() === 'yes',
    sgwSecurity: row.sgw_security !== 'No' && row.sgw_security !== '',
    freeAccess: row.free_access || 'None'
  };
}

const knowledgeBaseIndex = {
  metadata: {
    name: 'ADAS Knowledge Base Index',
    description: 'Master index of all OEM knowledge base contents',
    generated: new Date().toISOString(),
    version: '1.0',
    totalBrands: allBrands.size,
    totalSystems: allSystems.size,
    totalCalibrations: calibrations.length
  },
  brandsAvailable: [...allBrands].sort(),
  systemsCovered: [...allSystems].sort(),
  calibrationMethods: calibrationMethods,
  thirdPartySupport: thirdPartySummary,
  legalAccessLevels: legalAccessSummary,
  sourceFiles: {
    oemMaster: 'OEM_Master/oem_master_table.json',
    adasCalibrations: 'ADAS/adas_calibration_dataset.csv',
    equipment: 'Equipment/adas_equipment_providers.csv',
    thirdParty: 'Third_Party/third_party_platforms.json',
    legal: 'Legal/legal_access_dataset.csv',
    downloadPlan: 'OEM_Master/DOWNLOAD_PLAN.md'
  },
  derivedFiles: {
    targetSpecs: 'ADAS/target_specs.json',
    prerequisites: 'ADAS/prerequisites.json',
    quirks: 'ADAS/quirks.json',
    blockerDTCs: 'ADAS/blockerDTCs_from_dataset.json',
    equipmentProviders: 'Equipment/adas_equipment_providers.json'
  },
  criticalQuirks: [
    { brand: 'Nissan', quirk: 'Thrust angle MUST be ZERO - no exceptions' },
    { brand: 'Subaru', quirk: 'Level floor ±4mm tolerance; calibration sequence: alignment → SAS → lateral G → camera' },
    { brand: 'Honda', quirk: 'Battery support STRONGLY recommended; OEM windshield required' },
    { brand: 'BMW', quirk: 'Uses DYNAMIC camera calibration - unique among OEMs' },
    { brand: 'Stellantis', quirk: 'Autel is factory-approved; SGW bypass required 2020+' },
    { brand: 'Mercedes-Benz', quirk: 'Clone Xentry cannot perform Initial Startup' },
    { brand: 'Tesla', quirk: 'Owner can self-initiate dynamic calibration via menu' }
  ]
};

fs.writeFileSync(
  path.join(METADATA_OUTPUT_DIR, 'knowledge_base_index.json'),
  JSON.stringify(knowledgeBaseIndex, null, 2)
);
console.log(`   - Indexed ${allBrands.size} brands, ${allSystems.size} systems`);

console.log('\n✅ All derived datasets generated successfully!');
console.log('\nOutput files:');
console.log(`  - ${path.join(ADAS_OUTPUT_DIR, 'target_specs.json')}`);
console.log(`  - ${path.join(ADAS_OUTPUT_DIR, 'prerequisites.json')}`);
console.log(`  - ${path.join(ADAS_OUTPUT_DIR, 'quirks.json')}`);
console.log(`  - ${path.join(ADAS_OUTPUT_DIR, 'blockerDTCs_from_dataset.json')}`);
console.log(`  - ${path.join(EQUIPMENT_OUTPUT_DIR, 'adas_equipment_providers.json')}`);
console.log(`  - ${path.join(METADATA_OUTPUT_DIR, 'knowledge_base_index.json')}`);
