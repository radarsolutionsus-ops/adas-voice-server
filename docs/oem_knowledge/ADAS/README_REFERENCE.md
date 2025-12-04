# Reference Folder

## Purpose
Quick reference charts, target dimensions, and pre-calibration flowcharts for rapid lookup during ADAS calibration procedures.

## Folder Structure

### Calibration_Charts/
Quick reference charts showing calibration method by brand and system.

**Camera Calibration Method by Brand:**
| Brand | Method | Notes |
|-------|--------|-------|
| Toyota | Static | Printed targets |
| Honda | Static/Dynamic | Battery support needed |
| Nissan | Static | Thrust angle ZERO |
| Subaru | Static + Dynamic | 10-min test drive |
| BMW | **DYNAMIC** | Unique approach |
| Mercedes | Static | Fixture-based |
| GM | Self-calibrating | Plug and play |
| Ford | Static/Dynamic | Model dependent |
| VW/Audi | Static | VAS 6430 |
| Hyundai/Kia | Static | Rear axle reference |
| Tesla | Static + Dynamic | Owner can initiate |

**Radar Calibration Method by Brand:**
| Brand | Method | Tool |
|-------|--------|------|
| Toyota | Static | Trihedral reflector |
| Honda | Static | Bubble level |
| Nissan | Static | Bubble level + suction cup |
| BMW | Static | Targets |
| Mercedes | Static | Xentry + targets |
| GM | Self-calibrating | SPS programming |
| Ford | Static | FDRS + targets |

### Target_Dimensions/
Target size specifications and placement requirements.

**Common Target Placements:**
| Brand | Distance | Reference Point |
|-------|----------|-----------------|
| Subaru | 4,070mm | Front wheel centers |
| Toyota | Per model | Vehicle centerline |
| Honda | Per model | Front bumper |
| Hyundai/Kia | Per model | Rear axle |
| Tesla | 3 feet height | Ground level |

**Target Compatibility:**
- Tesla: Compatible with Hyundai/Kia LDW target
- Most OEMs: Require brand-specific targets
- Aftermarket: Autel, Hunter systems have universal targets

### Precal_Flowcharts/
Decision trees for pre-calibration requirements.

**Universal Pre-Calibration Checklist:**
1. ✓ Check for active DTCs
2. ✓ Verify wheel alignment (especially thrust angle)
3. ✓ Check tire pressure
4. ✓ Verify ride height (air suspension vehicles)
5. ✓ Check battery health
6. ✓ Ensure level floor (Subaru: ±4mm)
7. ✓ Verify fuel level (Ford: full tank recommended)
8. ✓ Clear vehicle of extra weight

**Brand-Specific Additions:**
- Honda: Connect battery support
- Nissan: Verify thrust angle is EXACTLY zero
- Subaru: Follow sequence: alignment → SAS → lateral G → camera
- Mercedes: Check Airmatic/ABC first
- VW/Audi: Air suspension control position cal first

## Quick Reference Cards

### Top 5 ADAS Quirks
1. **Nissan** - Thrust angle MUST be ZERO
2. **Subaru** - Level floor ±4mm; calibration sequence critical
3. **Honda** - Battery support; OEM glass required
4. **BMW** - Dynamic camera cal (not static)
5. **Stellantis** - Autel factory-approved; SGW bypass needed

### Equipment Quick Costs
| Equipment | Entry | Full |
|-----------|-------|------|
| Autel | $10-15K | $30-50K |
| Hunter | Premium | $50K+ |
| Bosch | $20-25K | $35-45K |
| Launch | $8-12K | $20-30K |
| Thinkcar | $5-8K | $15-20K |
