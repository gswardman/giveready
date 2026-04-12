-- Deep enrichment for 4 contactable nonprofits
-- Fresh web research: April 12, 2026
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/003-deep-enrich-four-nonprofits.sql

-- ============================================
-- 1. AIM Youth Mental Health (EIN: 47-3992060)
-- Carmel, CA | Founded 2014 | 4-star Charity Navigator
-- ============================================

UPDATE nonprofits SET
  tagline = 'Bridging youth mental health research and real-world solutions',
  mission = 'AIM Youth Mental Health bridges the gap between youth mental health research and access to care by finding, funding, and implementing evidence-based treatments and empowering youth to discover their own mental health solutions.',
  description = 'Founded in 2014 and based in Carmel, California, AIM Youth Mental Health works at the intersection of scientific research and youth-led innovation. AIM does not provide clinical treatment — it focuses on prevention, education, peer support, and strengthening connections to appropriate mental health resources. Key programmes include the AIM Ideas Lab (youth participatory action research across 37 schools), Youth Mental Health First Aid training for adults, and funded clinical research into anxiety, suicide prevention, and eating disorders. AIM partners with schools and community organisations in California, Arizona, and Texas, with an intentional focus on under-resourced, rural, and diverse communities. Rated 4/4 stars by Charity Navigator.',
  website = 'https://aimymh.org',
  city = 'Carmel',
  region = 'California',
  founded_year = 2014,
  beneficiaries_per_year = 1200,
  contact_email = 'info@aimymh.org',
  updated_at = datetime('now')
WHERE id = 'every-473992060';

-- Additional programme: AIM Funded Research
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-473992060-prog-3', 'every-473992060',
  'AIM Funded Research',
  'Funds early-stage clinical research to develop better treatments for youth mental health, including breakthroughs in anxiety interventions for preschoolers, suicide prediction and prevention, and family-centred approaches to eating disorders.',
  0, 'Multi-state'
);

-- Additional programme: Youth Ambassador Program
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-473992060-prog-4', 'every-473992060',
  'Youth Ambassador Programme',
  'Engages youth in mental health advocacy and community leadership. 44 youth participated in the revamped 2024 programme.',
  44, 'Multi-state'
);

-- Richer impact metrics
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-473992060-im-3', 'every-473992060', 'Ideas Lab participants', '90', 'students', 'annual', 2024),
  ('every-473992060-im-4', 'every-473992060', 'Schools reached by Ideas Lab', '37', 'schools', 'annual', 2024),
  ('every-473992060-im-5', 'every-473992060', 'Survey responses collected', '1150', 'responses', 'annual', 2024),
  ('every-473992060-im-6', 'every-473992060', 'Youth ambassadors', '44', 'youth', 'annual', 2024),
  ('every-473992060-im-7', 'every-473992060', 'Participants feeling safe in programme', '93', 'percent', 'annual', 2024),
  ('every-473992060-im-8', 'every-473992060', 'Gala fundraising', '650000', 'USD', 'annual', 2024);

-- Registration
INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('aim-us', 'every-473992060', 'United States', '501(c)(3)', '47-3992060');

-- ============================================
-- 2. YEScarolina / Engaging Creative Minds (EIN: 46-1710691)
-- Charleston, SC | Founded 2004 | 4-star Charity Navigator
-- ============================================

UPDATE nonprofits SET
  tagline = 'Teaching entrepreneurship to young South Carolinians',
  mission = 'YEScarolina teaches entrepreneurship to young South Carolinians of all socio-economic backgrounds to enhance their economic productivity by improving their business, academic, and life skills.',
  description = 'Founded in 2004 by Jimmy Bailey, YEScarolina is the only organisation in South Carolina dedicated to teaching youth the principles of entrepreneurship and free enterprise. The experiential curriculum — created by teachers, for teachers — includes a 26-hour online intensive certification, downloadable lesson plans, business plan templates, and access to the YEScarolina Teacher Community. Over 1,500 South Carolina teachers have been certified, reaching tens of thousands of students in grades 6-12. Students compete in the annual State Business Plan Competition. In 2021, YEScarolina merged with Engaging Creative Minds, creating a K-12 educational pipeline. Rated 4/4 stars by Charity Navigator.',
  website = 'https://yescarolina.com',
  city = 'Charleston',
  region = 'South Carolina',
  founded_year = 2004,
  beneficiaries_per_year = 5000,
  contact_email = 'hello@engagingcreativeminds.org',
  updated_at = datetime('now')
WHERE id = 'every-203562766';

-- Additional programme: Summer Business Camps
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-203562766-prog-3', 'every-203562766',
  'Summer Business Camps',
  'Intensive summer programmes providing entrepreneurship education and hands-on business skills training directly to students across South Carolina.',
  500, 'South Carolina'
);

-- Additional programme: State Business Plan Competition
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-203562766-prog-4', 'every-203562766',
  'State Business Plan Competition',
  'Annual in-school and state-level business plan competition. Students develop comprehensive business plans as the capstone of their entrepreneurship class.',
  1000, 'South Carolina'
);

-- Richer impact metrics
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-203562766-im-3', 'every-203562766', 'Charity Navigator rating', '4', 'stars (out of 4)', 'rating', 2026),
  ('every-203562766-im-4', 'every-203562766', 'Years operating', '22', 'years', 'cumulative', 2026);

-- Registration
INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('yes-us', 'every-203562766', 'United States', '501(c)(3)', '46-1710691');

-- ============================================
-- 3. Reintegration Support Network (EIN: 46-2369263)
-- Carrboro, NC | Youth peer support and mentoring
-- ============================================

UPDATE nonprofits SET
  tagline = 'Youth belonging, peer mentorship, and recovery-focused support',
  mission = 'Reintegration Support Network provides youth with a sense of belonging, the skills and capacities for self-advocacy, healthy relationships, and positive engagement in the community — empowering young people impacted by substance use, mental health, and justice involvement.',
  description = 'Originally founded as Youth Community Project, the organisation rebranded to Reintegration Support Network in May 2019. Based in Carrboro, North Carolina, RSN serves youth ages 13-20+ across Orange, Durham, Alamance, and Chatham Counties. Staffed by certified peer support specialists with lived recovery experience, RSN provides one-on-one mentoring, weekly peer support groups, and an 8-week Life Skills curriculum using SAMHSA Core Competencies. Young people are referred by schools, treatment programmes, family members, and the justice system. RSN received a 3-year, $600,000 federal BCOR grant from SAMHSA through partnership with Recovery Communities of North Carolina. Founded in memory of 18-year-old Matt McQuiston.',
  website = 'https://rsnnc.org',
  city = 'Carrboro',
  region = 'North Carolina',
  beneficiaries_per_year = 150,
  contact_email = 'youthfirst@rsnnc.org',
  updated_at = datetime('now')
WHERE id = 'every-462369263';

-- Additional programme: Life Skills Peer Support Groups
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-462369263-prog-3', 'every-462369263',
  'Life Skills Peer Support Groups',
  'Facilitated 8-week groups within schools and youth-serving organisations using SAMHSA Core Competencies curriculum. Focuses on healthy relationships, positive coping strategies, positive identity, and community engagement.',
  50, 'Orange, Durham, Alamance, Chatham Counties, NC'
);

-- Richer impact metrics
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-462369263-im-2', 'every-462369263', 'SAMHSA BCOR grant funding', '600000', 'USD', '3-year grant', 2025),
  ('every-462369263-im-3', 'every-462369263', 'Age range served', '13', 'minimum age', 'service criteria', 2025);

-- Registration
INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('rsn-us', 'every-462369263', 'United States', '501(c)(3)', '46-2369263');

-- ============================================
-- 4. Youth Music Project (EIN: 46-0923905)
-- West Linn, OR | Founded 2012 | GuideStar Platinum
-- ============================================

UPDATE nonprofits SET
  tagline = 'Music education for every young person, regardless of family income',
  mission = 'Youth Music Project provides outstanding rock, pop, and country music education for youth by offering tuition assistance, instrument rentals, and exceptional performance opportunities — ensuring every student has access regardless of family income.',
  description = 'Founded in 2012 by the Marie Lamfrom Charitable Foundation, Youth Music Project is Clackamas County''s only nonprofit music school. Located in West Linn, Oregon, the facility features 22 classrooms, a 200-seat performance hall, a cafe, music store, and professional recording studios. YMP offers private lessons, group classes, rock band ensembles, and summer camps in guitar, drums, bass, piano, ukulele, violin, vocals, and music production. Approximately 40% of all students receive tuition assistance, and YMP charges 60-84% less than area for-profit music schools. The school earned Candid GuideStar''s Platinum Seal of Transparency in 2024.',
  website = 'https://www.youthmusicproject.org',
  city = 'West Linn',
  region = 'Oregon',
  founded_year = 2012,
  beneficiaries_per_year = 3900,
  contact_email = 'info@youthmusicproject.org',
  updated_at = datetime('now')
WHERE id = 'every-460923905';

-- Additional programme: Rock Band Programme
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-460923905-prog-3', 'every-460923905',
  'Rock Band Programme',
  'Ensemble programme for students who have completed foundational coursework. Students learn song forms, arrangements, solos, and collaborative band dynamics while performing original arrangements.',
  200, 'West Linn, Oregon'
);

-- Additional programme: Summer Camps
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-460923905-prog-4', 'every-460923905',
  'Summer Camps',
  'Week-long day camps including Teen Week for ages 13+ with full-day instruction, group rehearsal, and performances.',
  150, 'West Linn, Oregon'
);

-- Richer impact metrics
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-460923905-im-3', 'every-460923905', 'Annual enrollments', '3900', 'enrollments', 'annual', 2025),
  ('every-460923905-im-4', 'every-460923905', 'Students receiving tuition assistance', '40', 'percent', 'annual', 2025),
  ('every-460923905-im-5', 'every-460923905', 'Cost savings vs for-profit schools', '60', 'percent minimum', 'comparison', 2025),
  ('every-460923905-im-6', 'every-460923905', 'Benefit auction fundraising', '255087', 'USD', 'annual', 2025);

-- Registration
INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('ymp-us', 'every-460923905', 'United States', '501(c)(3)', '46-0923905');

-- ============================================
-- New cause needed for peer support / substance recovery
-- ============================================

INSERT OR IGNORE INTO causes (id, name, description) VALUES
  ('peer-support', 'Peer Support & Recovery', 'Peer mentorship and recovery support for youth facing substance use, mental health, and justice system challenges');

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-462369263', 'peer-support');
