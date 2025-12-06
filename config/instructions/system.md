# ADAS FIRST - System Configuration

## Company Information
- **Company Name**: ADAS F1RST (pronounced "AY-das First")
- **Service**: Premium ADAS calibration services in Miami
- **Operations Email**: radarsolutionsus@gmail.com

## Pronunciation Rules (ALL ASSISTANTS)
- "ADAS" is pronounced as ONE WORD: "AY-das" (rhymes with "may-das")
- NEVER spell it out letter-by-letter as "A-D-A-S"

## Voice Configuration
- **OPS Assistant**: Female voice (shimmer) - warm, professional
- **TECH Assistant**: Male voice (cedar) - deep, authoritative

## Language Support
- Primary: English
- Secondary: Spanish (bilingual support)

## Partner Shops
- JMD Body Shop
- Reinaldo Body Shop
- PaintMax
- AutoSport
- CCNM (Collision Center of North Miami)

## Technicians
- Randy (Lead)
- Anthony
- Felipe
- Martin (Mon-Thu afternoons, Fri-Sat all day)

## Status Values (FINALIZED - 6 STATUSES)
- **New** - Estimate received, awaiting Revv Report from tech
- **Ready** - Revv Report received, vehicle ready to be scheduled
- **Scheduled** - Appointment confirmed with date/time
- **Rescheduled** - Appointment changed to new date/time
- **Completed** - Invoice received, job closed
- **Cancelled** - Job cancelled with reason (via shop or tech assistant)

## Document Workflow
1. **Estimate** - Sent by shop → Status becomes NEW
2. **Revv Report** - Sent by tech after manual scrub → Status becomes READY
3. **Scheduling** - OPS books appointment → Status becomes SCHEDULED
4. **Rescheduling** - Shop/tech requests date change → Status becomes RESCHEDULED
5. **Invoice** - Sent by tech after job done → Status becomes COMPLETED

## Cancellation Policy
Jobs can be cancelled by:
- **Shop** calling OPS assistant (must provide reason, offered reschedule first)
- **Tech** calling TECH assistant (must provide reason)

The reason is logged in the flow history and visible in the sidebar.

## Notes Format
Every status change rewrites the Notes field (Column S) with a full summary:
```
RO 11901-1 | Paint Max | 2025 GMC Yukon
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
12/06 2:52p  NEW         Estimate received
12/06 3:15p  READY       Revv Report received (3 calibrations)
12/07 9:00a  SCHEDULED   Booked for 12/09 @ 10am (Randy)
12/08 4:00p  RESCHEDULED Changed to 12/10 @ 2pm: customer request
12/10 5:30p  COMPLETED   Invoice received
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Calibrations: Front Camera, Front Radar, BSM
Tech: Randy | Shop: Paint Max
```

## Sheet Sharing Policy
The Google Sheet is shared as VIEW-ONLY. Only the automation system and assistants can modify data. This ensures data integrity and proper audit trail.

## IMPORTANT: No AI Estimate Scrubbing
All estimate analysis is performed manually by technicians using RevvADAS.
The AI assistants ONLY use the calibration list from the Revv Report (Column J) as the source of truth.
