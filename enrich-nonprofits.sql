-- GiveReady — Nonprofit Profile Enrichment
-- 10 orgs with real data from web research + email updates from scrape
-- Run against D1: npx wrangler d1 execute giveready-db --remote --file=enrich-nonprofits.sql
-- Generated: 2026-04-07

-- ============================================
-- EMAIL UPDATES (from unclaimed-nonprofits-with-emails.csv scrape)
-- AIM and RSN emails are set in their enrichment blocks below
-- ============================================

UPDATE nonprofits SET contact_email = 'info@aimymh.org', updated_at = datetime('now') WHERE slug = 'aim-youth-mental-health';
UPDATE nonprofits SET contact_email = 'hello@engagingcreativeminds.org', updated_at = datetime('now') WHERE slug = 'yescarolina-youth-entrepreneurship-in-south-carolina';
UPDATE nonprofits SET contact_email = 'info@youthmusicproject.org', updated_at = datetime('now') WHERE slug = 'youth-music-project';
UPDATE nonprofits SET contact_email = 'youthfirst@rsnnc.org', updated_at = datetime('now') WHERE slug = 'youth-community-project';

-- ============================================
-- 1. YEScarolina (Charleston, SC)
-- Youth entrepreneurship education. 1,500+ teachers trained. Chick-fil-A True Inspiration grant 2026.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Teaching youth the principles of entrepreneurship and free enterprise',
  mission = 'YEScarolina is the only organisation in South Carolina dedicated to teaching youth the principles of entrepreneurship and free enterprise. Through classroom programmes and educator training, YEScarolina helps thousands of students in grades 9-12 build business skills, financial literacy, and leadership experience.',
  description = 'YEScarolina delivers experiential entrepreneurship curriculum directly in classrooms and through educator training across South Carolina. The hands-on curriculum — created by teachers, for teachers — gives students the building blocks to complete a step-by-step business plan and compete in YEScarolina''s annual State Business Plan Competition. To date, YEScarolina has trained and certified over 1,500 South Carolina teachers on the subject of entrepreneurship. In 2026, the programme''s parent organisation Engaging Creative Minds received a $125,000 Chick-fil-A True Inspiration Award to expand YEScarolina into more high school classrooms. YEScarolina also serves middle school students with age-appropriate entrepreneurship programming.',
  website = 'http://yescarolina.com',
  city = 'Charleston',
  region = 'South Carolina',
  founded_year = 2004,
  beneficiaries_per_year = 2000,
  contact_email = 'hello@engagingcreativeminds.org',
  updated_at = datetime('now')
WHERE id = 'every-203562766';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-203562766', 'entrepreneurship');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-203562766', 'education');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-203562766-prog-1', 'every-203562766',
  'Classroom Entrepreneurship Programme',
  'Experiential curriculum delivered in grades 9-12 classrooms across South Carolina. Students complete a step-by-step business plan and compete in the annual State Business Plan Competition.',
  2000, 'South Carolina'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-203562766-prog-2', 'every-203562766',
  'Educator Training & Certification',
  'Training and certifying South Carolina teachers to deliver entrepreneurship curriculum in their classrooms. Over 1,500 teachers trained to date.',
  200, 'South Carolina'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-203562766-im-1', 'every-203562766', 'Teachers trained and certified', '1500', 'teachers', 'cumulative', 2026),
  ('every-203562766-im-2', 'every-203562766', 'Students served annually', '2000', 'students', 'annual', 2025);

-- ============================================
-- 2. Youth Music Project (West Linn, OR)
-- Nonprofit music school. 22 classrooms. 200-seat performance hall. Sliding-scale tuition.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Outstanding rock, pop, and country music education for youth',
  mission = 'Youth Music Project provides outstanding rock, pop, and country music education through group and private lessons, and provides students with exceptional, state-of-the-art performance and recording opportunities. Lessons are offered on a sliding scale, including free instruction and free instrument use for students on the free or reduced school lunch programme.',
  description = 'Youth Music Project is Clackamas County''s only nonprofit music school. The facility in West Linn, Oregon features 22 classrooms, a 200-person performance hall, a cafe and music store, and recording studios. Classes are offered year-round and include private lessons, group ensembles, and summer camps. YMP removes financial barriers by offering tuition assistance, instrument rentals, and sliding-scale pricing — ensuring that family income never prevents a young person from learning music.',
  website = 'https://www.youthmusicproject.org',
  city = 'West Linn',
  region = 'Oregon',
  founded_year = 2008,
  beneficiaries_per_year = 500,
  contact_email = 'info@youthmusicproject.org',
  updated_at = datetime('now')
WHERE id = 'every-460923905';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-460923905', 'creative-arts');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-460923905', 'education');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-460923905-prog-1', 'every-460923905',
  'Private & Group Music Lessons',
  'Year-round instruction in rock, pop, and country music. Private lessons and group ensembles across 22 classrooms. Sliding-scale tuition with free instruction for qualifying students.',
  400, 'West Linn, Oregon'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-460923905-prog-2', 'every-460923905',
  'Performance & Recording',
  'Students perform in a 200-person concert hall and record in professional studios. Summer camps and seasonal showcases throughout the year.',
  200, 'West Linn, Oregon'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-460923905-im-1', 'every-460923905', 'Classrooms', '22', 'rooms', 'facility', 2025),
  ('every-460923905-im-2', 'every-460923905', 'Performance hall capacity', '200', 'seats', 'facility', 2025);

-- ============================================
-- 3. AIM Youth Mental Health (multi-state: CA, AZ, TX)
-- Research-to-practice. 3,000 adults trained in Youth Mental Health First Aid. Ideas Lab youth research.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Bridging the gap between youth mental health research and access to care',
  mission = 'AIM Youth Mental Health bridges the gap between research and access to care for young people struggling with their mental health. AIM finds, funds, and implements evidence-based treatments, empowers youth to discover their own mental health solutions, and trains caring adults to create safe communities where children can grow and thrive.',
  description = 'Founded in 2014, AIM Youth Mental Health works at the intersection of scientific research and youth-led innovation to improve mental health outcomes. AIM is not a therapy practice — it focuses on prevention, education, peer support, and strengthening connections to appropriate mental health resources. AIM partners with schools and community organisations in California, Arizona, and Texas, with an intentional focus on under-resourced, rural, and diverse communities. Key programmes include the AIM Ideas Lab (youth-led research), the AIM Clinical Science Fellowship (early-career researcher grants), and Youth Mental Health First Aid training for adults. To date, AIM has trained and certified 3,000 parents, teachers, coaches, and staff from 63 youth-serving organisations.',
  website = 'https://aimymh.org',
  city = '',
  region = 'California, Arizona, Texas',
  founded_year = 2014,
  beneficiaries_per_year = 1000,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-473992060';

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-473992060-prog-1', 'every-473992060',
  'Youth Mental Health First Aid Training',
  'Training and certifying parents, teachers, coaches, and staff to recognise and respond to mental health challenges in young people. 3,000 adults trained across 63 organisations.',
  500, 'California, Arizona, Texas'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-473992060-prog-2', 'every-473992060',
  'AIM Ideas Lab',
  'Youth-led research programme where high school students design and lead projects that improve youth mental health. Students apply competitively and work with AIM mentors.',
  50, 'Multi-state'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-473992060-prog-3', 'every-473992060',
  'AIM for Awareness Design Challenge',
  'Middle and high school students use creativity to raise awareness about youth mental health, reduce stigma, and inspire hope through artwork and ad designs.',
  200, 'Multi-state'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-473992060-im-1', 'every-473992060', 'Adults trained in Youth Mental Health First Aid', '3000', 'adults', 'cumulative', 2026),
  ('every-473992060-im-2', 'every-473992060', 'Youth-serving organisations partnered', '63', 'organisations', 'cumulative', 2026);

-- ============================================
-- 4. Outdoor Youth Exploration Academy / OYEA (Indianapolis, IN)
-- Urban youth outdoor education since 1988. Archery, fishing, conservation. Environmental stewardship.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Empowering urban youth through outdoor sporting experiences and environmental stewardship',
  mission = 'The Outdoor Youth Exploration Academy (OYEA!) mentors urban youth to develop life and leadership skills while nurturing environmental responsibility through engaging outdoor sporting experiences. OYEA enlightens young people about their roles as keepers of the environment while imparting enduring outdoor recreational expertise.',
  description = 'Founded by The Dirty Dozen Hunting and Fishing Club, OYEA has been operating youth programmes in central Indiana since 1988 — over 35 years of continuous service. Members receive instruction in archery, fishing, air rifle target shooting, land and water conservation, and hunting safety. These disciplines, often overlooked in urban settings, hold potential for college scholarships and participation in Olympic sporting events. OYEA members also participate in community cleanups to protect urban waterways. The organisation operates from a facility at 2415 E 39th St, Indianapolis.',
  website = 'https://www.oyeaindy.org',
  city = 'Indianapolis',
  region = 'Indiana',
  founded_year = 1988,
  beneficiaries_per_year = 200,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-352062273';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-352062273', 'education');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-352062273', 'community-development');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-352062273-prog-1', 'every-352062273',
  'Outdoor Sporting & Leadership',
  'Year-round instruction in archery, fishing, air rifle target shooting, and hunting safety. Youth develop discipline, leadership, and skills with scholarship and Olympic potential.',
  150, 'Indianapolis, Indiana'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-352062273-prog-2', 'every-352062273',
  'Environmental Stewardship',
  'Community waterway cleanups and conservation education. Youth learn their role as environmental stewards in urban settings.',
  100, 'Indianapolis, Indiana'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-352062273-im-1', 'every-352062273', 'Years of continuous operation', '37', 'years', 'cumulative', 2025);

-- ============================================
-- 5. Youth & Families Determined to Succeed (Minneapolis, MN)
-- Founded by former NFL player Melvin Anderson. 25+ years. 350+ families in health programme.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Advancing health equity, family wellness, and youth achievement',
  mission = 'Youth & Families Determined to Succeed (YFDS) is a community-based nonprofit committed to advancing health equity, family wellness, and youth achievement. For over 25 years, YFDS has produced meaningful results in leadership, health, and athletics for families in North Minneapolis.',
  description = 'Founded in 1999 by former Minnesota Gopher and Pittsburgh Steelers receiver Melvin Anderson, YFDS provides comprehensive health, nutrition, fitness, and enrichment programmes for children and families. In 2010, YFDS launched F4H (Fitness for Health), an evidence-based wellness programme serving families referred by physicians for health restoration — addressing obesity, diabetes, and heart disease through fitness, nutrition, and mental wellbeing. Over 350 families have participated, with 70% referred by physicians. YFDS operates from North Minneapolis with a Wellness Fitness Center in New Hope.',
  website = 'https://yfds.org',
  city = 'Minneapolis',
  region = 'Minnesota',
  founded_year = 1999,
  beneficiaries_per_year = 350,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-020687131';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-020687131', 'mental-health');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-020687131', 'community-development');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-020687131-prog-1', 'every-020687131',
  'F4H (Fitness for Health)',
  'Evidence-based wellness programme for families referred by physicians. Addresses obesity, diabetes, and heart disease through fitness, nutrition, and mental wellbeing. 70% of participants are physician-referred.',
  350, 'Minneapolis and New Hope, Minnesota'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-020687131-im-1', 'every-020687131', 'Families served through F4H', '350', 'families', 'cumulative', 2025),
  ('every-020687131-im-2', 'every-020687131', 'Physician referral rate', '70', 'percent', 'annual', 2025),
  ('every-020687131-im-3', 'every-020687131', 'Years of continuous operation', '26', 'years', 'cumulative', 2025);

-- ============================================
-- 6. Ironwood Tree Experience / Youth Outdoor Experience (Tucson, AZ)
-- 20 years of outdoor education in the Sonoran Desert. Wilderness Warriors. Youth Action Corps.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Inspiring young people to flourish by engaging with nature',
  mission = 'Ironwood Tree Experience inspires young people to flourish by engaging with nature and becoming mindful stewards of the environment at home, in their community, and around the world.',
  description = 'Co-founded in 2005 by Eric and Suzanne Dhruv, Ironwood Tree Experience (ITE) has been leading outdoor education programmes in the Sonoran Desert and beyond for 20 years. ITE provides young people with active, fun, and educational experiences at their Field Station, in urban environments, and throughout diverse natural destinations. The organisation expresses its commitment to community through urban and rural stewardship programmes including Youth Action Corps leadership projects and the Wilderness Warriors and Youth Ambassadors for SW Cultures internships. Originally established as a sponsored programme of Prescott College, ITE incorporated as an Arizona nonprofit in 2013.',
  website = 'https://ironwoodtreeexperience.org',
  city = 'Tucson',
  region = 'Arizona',
  founded_year = 2005,
  beneficiaries_per_year = 300,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-464125968';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-464125968', 'education');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-464125968', 'community-development');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-464125968-prog-1', 'every-464125968',
  'Wilderness Warriors & Youth Ambassadors',
  'Internship programmes combining outdoor skills with cultural education in Sonoran Desert ecosystems and Southwest cultures.',
  50, 'Tucson, Arizona'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-464125968-prog-2', 'every-464125968',
  'Youth Action Corps',
  'Leadership programme where young people lead urban and rural stewardship projects in their communities.',
  100, 'Tucson, Arizona'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-464125968-im-1', 'every-464125968', 'Years of outdoor education', '20', 'years', 'cumulative', 2025);

-- ============================================
-- 7. Grow & Lead (Marquette, MI)
-- Nonprofit capacity builder in rural Upper Peninsula. Kellogg Foundation roots. 75+ years combined experience.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Helping rural communities and youth create positive change',
  mission = 'Grow & Lead uses research, consultation, and innovative programme development to help nonprofit organisations in rural communities of Michigan''s Upper Peninsula identify opportunities to create healthier and more sustainable communities. Grow & Lead supports youth as they create positive change and become successful adults.',
  description = 'Grow & Lead began as part of the Kellogg Youth Initiative Partnerships, a 20-year effort by the W.K. Kellogg Foundation to improve the youth environment in Michigan. Marquette and Alger Counties were the rural remote site of this long-term youth development effort. The organisation provides skill-building workshops, tailored consulting and training, and spreads new ideas, technology, and resources to UP nonprofits. The team brings over 75 years of combined experience in community engagement, nonprofit management, and youth development. The Excellence in Education programme recognises outstanding students and educators in Marquette and Alger Counties.',
  website = 'https://glcyd.org',
  city = 'Marquette',
  region = 'Michigan',
  founded_year = 1998,
  beneficiaries_per_year = 500,
  contact_email = 'info@glcyd.org',
  updated_at = datetime('now')
WHERE id = 'every-383522344';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-383522344', 'education');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-383522344-prog-1', 'every-383522344',
  'Excellence in Education',
  'Public recognition programme for outstanding students and educators in Marquette and Alger Counties.',
  200, 'Marquette and Alger Counties, Michigan'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-383522344-prog-2', 'every-383522344',
  'Nonprofit Capacity Building',
  'Skill-building workshops, tailored consulting, and training for rural UP nonprofits. Helping organisations strengthen their community impact.',
  50, 'Upper Peninsula, Michigan'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-383522344-im-1', 'every-383522344', 'Combined team experience in youth development', '75', 'years', 'team', 2025);

-- ============================================
-- 8. Community Works Youth Development (location TBC)
-- Leadership and creativity programmes for K-12 students. Multi-media campaigns. Annual symposiums.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Empowering the next generation of leaders to effect change',
  mission = 'Community Works empowers the next generation of leaders to effect change, delivering programmes to equip elementary, middle, and high school students with the skills and tools they need to discover their futures and find their voices.',
  description = 'Community Works delivers hands-on, school and community-based programmes across elementary, middle, and high school levels. The programmes catalyse new ways of thinking about creativity and problem-solving, and prepare students for a changing workforce. Through annual symposiums, shared research, and a growing multi-media campaign, Community Works has built an extensive community of leaders and experts working to change the fields of education, youth development, and creativity.',
  website = 'https://mycommunityworks.org',
  city = '',
  region = '',
  beneficiaries_per_year = 300,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-464851783';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-464851783', 'education');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-464851783', 'creative-arts');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-464851783-prog-1', 'every-464851783',
  'Leadership & Creativity Programme',
  'Hands-on school and community-based programmes helping K-12 students develop leadership, creativity, and problem-solving skills for a changing workforce.',
  300, 'United States'
);

-- ============================================
-- 9. Youth Aspiring Bold Empowerment (Los Angeles, CA)
-- Educational development for underserved youth.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Equipping youth in underserved communities to reach their full potential',
  mission = 'Youth Aspiring Bold Empowerment provides programmes that educate, enrich, and equip youth in underserved communities to reach their full potential.',
  description = 'Youth Aspiring Bold Empowerment is a 501(c)(3) youth educational development programme based in Los Angeles. The organisation designs and delivers programmes focused on education, enrichment, and empowerment for young people in underserved communities.',
  website = 'http://youthaspiringboldempowerment.org',
  city = 'Los Angeles',
  region = 'California',
  beneficiaries_per_year = 100,
  contact_email = '',
  updated_at = datetime('now')
WHERE id = 'every-453976098';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-453976098', 'education');

-- ============================================
-- 10. Reintegration Support Network / Youth Community Project (Carrboro, NC)
-- Youth reintegration support. Mentoring. Peer support groups. Justice system referrals.
-- ============================================

UPDATE nonprofits SET
  tagline = 'Providing youth a sense of belonging and the skills for positive community engagement',
  mission = 'Reintegration Support Network provides youth with a sense of belonging, the skills and capacities for self-advocacy, healthy relationships, and positive engagement in the community. The organisation serves Alamance, Chatham, Orange, and Durham Counties in North Carolina.',
  description = 'Originally founded as Youth Community Project, the organisation changed its name to Reintegration Support Network in 2019 to better reflect its mission. RSN is a 501(c)(3) nonprofit that helps youth in Orange and Durham counties develop positive relationships with their families, peers, and teachers. Through their Mentor Programme, Youth Peer Support Groups, community-based partnerships, and resource network, RSN supports young people referred by schools, treatment programmes, community partners, family members, and the justice system.',
  website = 'https://rsnnc.org',
  city = 'Carrboro',
  region = 'North Carolina',
  founded_year = 2005,
  beneficiaries_per_year = 150,
  contact_email = 'youthfirst@rsnnc.org',
  updated_at = datetime('now')
WHERE id = 'every-462369263';

INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-462369263', 'mental-health');
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('every-462369263', 'community-development');

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-462369263-prog-1', 'every-462369263',
  'Mentor Programme',
  'One-on-one mentoring for youth referred by schools, treatment programmes, and the justice system. Building positive relationships and self-advocacy skills.',
  75, 'Orange and Durham Counties, North Carolina'
);

INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES (
  'every-462369263-prog-2', 'every-462369263',
  'Youth Peer Support Groups',
  'Group sessions where young people develop healthy relationship skills and community engagement alongside their peers.',
  75, 'Orange and Durham Counties, North Carolina'
);

INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('every-462369263-im-1', 'every-462369263', 'Counties served', '4', 'counties', 'service area', 2025);
