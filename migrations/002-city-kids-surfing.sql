-- Add City Kids Surfing to GiveReady
-- Joe Taylor's charity, onboarded April 8 2026
-- UK Charity Commission number: 1182899
-- Wallet address TBD — Joe set up Phantom but address not yet recorded

INSERT OR IGNORE INTO nonprofits (
  id, slug, name, tagline, mission, description, website, donation_url,
  country, city, region, founded_year, annual_budget_usd, budget_year,
  team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned
) VALUES (
  'city-kids-surfing',
  'city-kids-surfing',
  'City Kids Surfing',
  'Getting city kids into the ocean',
  'City Kids Surfing takes young people from urban environments into the sea — using surfing as a tool for building confidence, resilience, and mental wellbeing.',
  'Founded in 2017 by Joe Taylor, City Kids Surfing runs an annual surf trip and year-round mentoring programme for around 30 young people from urban communities. The charity uses surf therapy and outdoor adventure to support youth facing challenges with mental health, confidence, and social isolation. Registered with the UK Charity Commission (1182899), City Kids Surfing is a small, hands-on charity where every participant gets direct, sustained support. Joe Taylor also founded The Wave Project, the world''s first surf-therapy-on-prescription charity, and brings that clinical evidence base to City Kids'' more intimate, mentorship-driven model.',
  'https://getcitykidssurfing.com',
  'https://getcitykidssurfing.com/donate',
  'United Kingdom',
  'London',
  'England',
  2017,
  50000,
  2025,
  5,
  30,
  'joe@getcitykidssurfing.com',
  1,
  1
);

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('city-kids-surfing', 'youth-empowerment'),
  ('city-kids-surfing', 'mental-health'),
  ('city-kids-surfing', 'surf-therapy');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES
  ('cks-surf-trip', 'city-kids-surfing', 'Annual Surf Trip', 'Multi-day residential surf trip taking young people from the city to the coast. Participants learn to surf, spend time in nature, and build relationships with mentors and peers.', 30, 'UK coast'),
  ('cks-mentoring', 'city-kids-surfing', 'Mentoring Programme', 'Year-round one-to-one mentoring for young people, providing ongoing support, goal-setting, and connection between surf trips.', 30, 'London');

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('cks-kids', 'city-kids-surfing', 'Young people supported annually', '30', 'young people', 'annual', 2025),
  ('cks-years', 'city-kids-surfing', 'Years operating', '8', 'years', 'cumulative', 2025);

INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('cks-uk', 'city-kids-surfing', 'United Kingdom', 'Registered Charity', '1182899');
