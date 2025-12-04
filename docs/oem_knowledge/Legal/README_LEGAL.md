# Legal Access Folder

## Purpose
Documentation of legal requirements, security credentials, and regional regulations for accessing OEM service information.

## Folder Structure

### NASTF/
National Automotive Service Task Force registration requirements and documentation.

**Registration Portal:** https://sdrm.nastfsecurityregistry.org

**Required Documents:**
- SSN and Federal Tax ID
- Professional license info (where applicable)
- Proof of employment/ownership
- Commercial General Liability insurance ($1M aggregate/$500K per event)
- Employee dishonesty/surety bond
- Notarized application
- Criminal background check

**Key Facts:**
- Cost: FREE registration
- Validity: 2 years
- Processing: 2-3 weeks (up to 30 days)
- MFA: Twilio Authy app required

**Credential Types:**
| Type | Purpose |
|------|---------|
| VSP | Vehicle Security Professional - standard access |
| LSID | Locksmith identification |
| PPN | Porsche Partner Network (Porsche only) |

### OEM_Restrictions/
OEM-specific access restrictions and dealer-only functions.

**Most Restrictive OEMs:**
1. **Porsche** - PPN membership required; PIWIS $23K+/year
2. **BMW** - Key codes only in California
3. **Mercedes** - Clone tools cannot do Initial Startup
4. **Stellantis** - SGW bypass required for 2020+ vehicles

**Security Gateway (SGW) OEMs:**
- Stellantis (2020+)
- VW/Audi (GeKo)
- Porsche (dealer certification)
- Tesla (limited functions)

### Region_Laws/
Regional right-to-repair legislation and regulations.

**United States:**
- Massachusetts 2020: Telematics access for MY2022+
- Maine 2023: February 2025 implementation
- Federal REPAIR Act: Reintroduced Feb 2025 (stalled)

**European Union:**
- MVBER: Extended through May 2028
- Non-discriminatory access mandated

**United Kingdom:**
- MVBEO (June 2023): Similar to EU

**Australia:**
- AASRA (July 2022): $90/year general, $210/year VSP

## Access Level Summary

| OEM | Free | Paid Subscription | NASTF Required |
|-----|------|-------------------|----------------|
| Toyota | Manuals/Recalls | Full procedures | Yes (VSP) |
| Honda | Basic specs | i-HDS access | Yes (VSP) |
| GM | TSB index | Full TDS | Yes (2020+) |
| Ford | Basic info | Full FDRS | Yes (2020+) |
| Stellantis | Recalls | wiTECH | Yes (2016+) |
| BMW | Some bulletins | Full ISTA | Yes (key codes CA only) |
| Tesla | Service docs | Toolbox 3.0 | No |

## Legal Collection Guidelines

**Permitted:**
- Downloading during active subscription
- Printing for internal use
- Creating reference summaries
- Building searchable indexes

**Prohibited:**
- Redistributing OEM data
- Creating competing databases
- Sharing credentials
- Scraping beyond ToS
