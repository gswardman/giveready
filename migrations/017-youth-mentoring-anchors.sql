-- Migration 017 — Youth-mentoring verified anchors
-- Date: 2026-06-21
-- Purpose: Add genuinely-verified youth-mentoring charities to support the
-- first Tier-1 keyword-expansion guide (best youth mentoring charities, US + UK).
-- Each org was checked against an authoritative registry before tagging verified:
--   Friends for Youth   — US 501(c)(3), EIN 94-2961034 (GuideStar/Candid)
--   MCR Pathways        — Scottish charity, OSCR SC045816
--   Mentoring Plus      — England & Wales charity, Charity Commission 1112534
-- Reintegration Support Network (youth-community-project) and Grow & Lead are
-- already verified (migration history) and round out the US side of the guide.
-- Chance UK was evaluated and EXCLUDED: it is winding down and no longer accepts
-- donations, so it must not appear as a donate destination.

-- Friends for Youth already exists as an unverified import (id every-942961034).
-- Promote it to verified with full curated fields.
UPDATE nonprofits SET
  name = 'Friends for Youth',
  tagline = 'One-to-one mentoring for low-income youth',
  mission = 'Friends for Youth creates and supports one-to-one mentoring relationships between caring adult volunteers and young people facing socioeconomic obstacles.',
  description = 'Friends for Youth is a US 501(c)(3) nonprofit (EIN 94-2961034) founded in 1979 and based in Redwood City, California. It provides community-based one-to-one mentoring to low-income youth aged 8 to 17 across San Mateo and northern Santa Clara counties, and has fostered more than 2,500 mentor-mentee matches with a long-term match rate well above the national average.',
  website = 'https://www.friendsforyouth.org',
  donation_url = 'https://www.friendsforyouth.org',
  country = 'United States',
  city = 'Redwood City',
  region = 'California',
  founded_year = 1979,
  verified = 1,
  updated_at = datetime('now')
WHERE slug = 'friends-for-youth';

INSERT OR IGNORE INTO nonprofits (id, slug, name, tagline, mission, description, website, donation_url, country, city, region, founded_year, beneficiaries_per_year, verified, created_at, updated_at) VALUES
  ('np-mcr-pathways', 'mcr-pathways',
   'MCR Pathways',
   'Mentoring for care-experienced and disadvantaged young people',
   'MCR Pathways matches care-experienced and disadvantaged young people with a trained volunteer mentor who meets them for one hour a week to help them stay engaged with school and realise their potential.',
   'MCR Pathways is a Scottish Charitable Incorporated Organisation regulated by OSCR (Scottish charity number SC045816), founded in Glasgow in 2007. Its school-based mentoring programme supports care-experienced and disadvantaged young people across more than 100 schools in Scotland, pairing each with a volunteer mentor for one hour a week.',
   'https://mcrpathways.org', 'https://mcrpathways.org',
   'United Kingdom', 'Glasgow', 'Scotland',
   2007, NULL, 1, datetime('now'), datetime('now')),
  ('np-mentoring-plus', 'mentoring-plus',
   'Mentoring Plus',
   'Tailored mentoring for young people facing challenges',
   'Mentoring Plus supports young people facing difficulties at home or school through one-to-one mentoring, inclusive youth clubs, and activities that build confidence and reconnect them with education.',
   'Mentoring Plus is an England & Wales registered charity (Charity Commission number 1112534), based at the Riverside Youth Hub in Bath. It supports young people aged 5 to 25 across Bath & North East Somerset through tailored one-to-one mentoring, youth clubs, and activities that improve wellbeing and re-engagement with education.',
   'https://mentoringplus.net', 'https://mentoringplus.net',
   'United Kingdom', 'Bath', 'England',
   2005, NULL, 1, datetime('now'), datetime('now'));

-- Cause links (friends-for-youth keeps its existing import id every-942961034)
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('every-942961034', 'youth-empowerment'),
  ('every-942961034', 'education'),
  ('np-mcr-pathways', 'youth-empowerment'),
  ('np-mcr-pathways', 'education'),
  ('np-mentoring-plus', 'youth-empowerment'),
  ('np-mentoring-plus', 'education');

-- Registrations (verified against IRS/OSCR/Charity Commission, 2026-06-21)
INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('reg-ffy', 'every-942961034', 'United States', '501(c)(3)', '94-2961034'),
  ('reg-mcr', 'np-mcr-pathways', 'United Kingdom', 'OSCR', 'SC045816'),
  ('reg-mentoring-plus', 'np-mentoring-plus', 'United Kingdom', 'Charity Commission', '1112534');
