# ADAS Folder

## Purpose
Central repository for all ADAS calibration information organized by topic.

## Folder Structure

### By_Brand/
Calibration procedures organized by manufacturer. Quick reference for brand-specific requirements.

### Target_Specs/
Target board dimensions, placement requirements, and specifications:
- Toyota: 2-3 printed targets + P/N 09870-60040 reflector for radar
- Honda: Model-specific targets; LaneWatch target separate
- Nissan: Printed targets + bubble level for radar
- Subaru: 4,070mm placement from front wheel centers
- VW/Audi: VAS 6430 system targets
- Hyundai/Kia: Rear axle reference point
- Tesla: Hyundai/Kia LDW target compatible

### Prerequisites/
Pre-calibration requirements by brand:

| Brand | Critical Prerequisites |
|-------|----------------------|
| Toyota | Alignment verified; VCH clear post-cal |
| Honda | Battery support; 4-wheel alignment; OEM glass |
| Nissan | PERFECT alignment; thrust angle ZERO |
| Subaru | Level floor ±4mm; sequence: alignment→SAS→lateral G→camera |
| VW/Audi | Empty vehicle; 3/4 tank fuel; air suspension cal first |
| BMW | Standard alignment (camera is dynamic cal) |
| Mercedes | Check Airmatic/ABC first; battery health critical |
| GM | Standard - mostly self-calibrating |
| Ford | Full fuel tank for proper level |
| Stellantis | SGW bypass on 2020+ |

### DTC_Blockers/
DTCs that prevent calibration from completing:
- Camera system DTCs
- Radar DTCs
- SAS (Steering Angle Sensor) DTCs
- Module communication faults
- Lighting system faults (some brands)

### Known_Quirks/
Critical brand-specific issues:

**CRITICAL QUIRKS:**
1. **BMW** - Uses DYNAMIC calibration for cameras (unique)
2. **Nissan** - Thrust angle must be EXACTLY ZERO
3. **Subaru** - Level floor ±4mm; 13ft calibration box
4. **Honda** - OEM windshield required; aftermarket causes failures
5. **Mercedes** - Clone Xentry cannot do Initial Startup
6. **Stellantis** - Autel is factory-approved for ADAS
7. **Tesla** - Owner can self-initiate dynamic cal via menu

## Calibration Method Summary

| Brand | Camera | Radar |
|-------|--------|-------|
| Toyota | Static | Static |
| Honda | Static/Dynamic | Static |
| Nissan | Static | Static |
| Subaru | Static + Dynamic (test drive) | N/A |
| BMW | **DYNAMIC** | Static |
| Mercedes | Static | Static |
| GM | Self-calibrating | Self-calibrating |
| VW/Audi | Static | Static |
| Hyundai/Kia | Static | Static |
| Tesla | Static + Dynamic | Static |
