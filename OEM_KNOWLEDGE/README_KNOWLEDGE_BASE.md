# ADAS Knowledge Base

## Complete OEM Service Information, ADAS Calibration, and Repair Database Directory

**Version:** 1.0  
**Created:** December 2025  
**Purpose:** AI-ready knowledge base for automotive ADAS calibration and OEM service information

---

## Overview

This knowledge base contains structured datasets covering:
- **54+ OEM service portals** with pricing, access requirements, and direct links
- **48+ ADAS calibration procedures** with prerequisites, triggers, and quirks
- **14+ third-party platforms** compared by coverage, quality, and pricing
- **9 ADAS equipment providers** with costs and OEM approvals
- **Legal access requirements** including NASTF, regional laws, and right-to-repair

---

## Folder Structure

```
ADAS_Knowledge_Base/
├── Datasets/
│   ├── CSV/                    # Machine-readable CSV files
│   └── JSON/                   # AI-optimized JSON with metadata
├── OEM/
│   └── [Brand]/                # Brand-specific folders
│       ├── Portals/            # Portal links and access info
│       ├── ADAS/               # Calibration procedures
│       ├── Programming/        # Diagnostic software info
│       ├── PDFs/               # Downloaded documentation
│       └── Notes/              # Brand-specific quirks
├── ADAS/
│   ├── By_Brand/               # Calibration by manufacturer
│   ├── Target_Specs/           # Target dimensions and requirements
│   ├── Prerequisites/          # Pre-calibration requirements
│   ├── DTC_Blockers/           # DTCs that block calibration
│   └── Known_Quirks/           # Brand-specific issues
├── Third_Party/
│   └── [Platform]/             # Third-party platform info
├── Legal/
│   ├── NASTF/                  # NASTF registration requirements
│   ├── OEM_Restrictions/       # OEM-specific restrictions
│   └── Region_Laws/            # Regional right-to-repair laws
├── Reference/
│   ├── Calibration_Charts/     # Quick reference charts
│   ├── Target_Dimensions/      # Target size specifications
│   └── Precal_Flowcharts/      # Pre-calibration decision trees
└── Documentation/
    ├── README.md               # This file
    ├── DOWNLOAD_PLAN.md        # What to download from each OEM
    ├── IMPORT_GUIDE.md         # How to load into AI systems
    └── knowledge_base_index.json  # Master index file
```

---

## Quick Start

### For AI Assistant Integration

1. Load `Datasets/JSON/knowledge_base_index.json` as your primary reference
2. Use CSV files for tabular queries
3. Use JSON files for structured data retrieval
4. Reference README files in each folder for context

### For Manual Reference

1. Start with `Datasets/CSV/oem_master_table.csv` for portal overview
2. Use `adas_calibration_dataset.csv` for specific calibration procedures
3. Check `legal_access_dataset.csv` for access requirements

---

## System Code Legend

| Code | Meaning |
|------|---------|
| FCAM | Forward Camera |
| FRR | Front Radar |
| RRR | Rear Radar |
| BSM | Blind Spot Monitor |
| MWR | Millimeter Wave Radar |
| AVM | Around View Monitor |
| SAS | Steering Angle Sensor |
| ESC | EyeSight Camera |
| ACC | Adaptive Cruise Control |
| DTR | DISTRONIC Radar |
| LIDAR | Light Detection and Ranging |

---

## Critical Notes

### Top 5 ADAS Quirks to Know

1. **Nissan:** Thrust angle MUST be ZERO - no exceptions
2. **Subaru:** Level floor ±4mm tolerance; calibration sequence critical
3. **Honda:** Battery support STRONGLY recommended; OEM glass required
4. **BMW:** Uses DYNAMIC camera calibration - unique among OEMs
5. **Stellantis:** Autel is factory-approved; SGW bypass required 2020+

### Security Requirements

- Most OEMs require NASTF VSP for security functions
- Processing time: 2-3 weeks typical
- Cost: FREE registration, 2-year validity
- Portal: https://sdrm.nastfsecurityregistry.org

---

## Update Frequency

| Source Type | Update Frequency |
|------------|-----------------|
| OEM Service Manuals | Quarterly |
| TSBs | Weekly |
| ADAS Procedures | Monthly |
| Position Statements | As published |
| Calibration Equipment | With software updates |

---

## File Naming Convention

```
[BRAND]_[SYSTEM]_[YEAR_RANGE]_[DOC_TYPE]_[VERSION]_[DATE].ext

Examples:
TOYOTA_TSS2_2020-2025_CAMERA_CALIBRATION_V3_2024-11.pdf
HONDA_SENSING_2019-2024_RADAR_PROCEDURE_V2_2024-08.pdf
SUBARU_EYESIGHT_2020-2025_FLOOR_REQUIREMENTS_V1_2024-06.pdf
```

---

## Contact and Updates

This knowledge base should be updated:
- Monthly for ADAS procedures
- Weekly for TSBs
- Quarterly for subscription pricing
- As published for position statements

---

## License and Legal

This knowledge base is intended for internal reference. OEM data should be obtained through proper subscriptions. Do not redistribute OEM-copyrighted content.
