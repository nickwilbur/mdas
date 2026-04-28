import type {
  CanonicalAccount,
  CanonicalOpportunity,
  CSESentiment,
  CerebroRiskCategory,
  CerebroRisks,
  SourceLink,
} from '@mdas/canonical';

const FRANCHISE = 'Expand 3';

// Real Expand 3 accounts from Glean (FY27 - Expand 3 Account Changes spreadsheet)
const REAL_EXPAND_3_ACCOUNTS = [
  { sfid: '0017000001TL8uwAAD', name: 'Adweek, LLC', products: ["Zephr"] },
  { sfid: '0017000000nsQPHAA2', name: 'WEHCO Media, Inc', products: ["Zephr"] },
  { sfid: '0017000000j2jlwAAA', name: 'Quotit Corporation', products: ["Billing"] },
  { sfid: '0017000000uJ9uSAAS', name: 'Teladoc Health, Inc.', products: ["RevPro"] },
  { sfid: '0017000000YruVLAAZ', name: 'Acquia, Inc.', products: ["Billing"] },
  { sfid: '0017000001SDBrqAAH', name: 'IBM Corporation', products: ["Billing"] },
  { sfid: '0017000000PnYcNAAV', name: 'Riverbed Technology', products: ["RevPro"] },
  { sfid: '0017000000nsQV2AAM', name: 'Rimini Street, Inc.', products: ["RevPro"] },
  { sfid: '0017000000koAphAAE', name: 'Prezi', products: ["Billing"] },
  { sfid: '00170000018Ip9UAAS', name: 'Automation Anywhere Inc.', products: ["RevPro"] },
  { sfid: '0017000000SxbSWAAZ', name: 'Tobii Dynavox', products: ["Billing"] },
  { sfid: '0017000000zWBGNAA4', name: 'GoAnimate, Inc. (Vyond)', products: ["Billing"] },
  { sfid: '0017000000jKKmrAAG', name: 'Bird.com Inc. (fka MessageBird USA Inc.)', products: ["Billing"] },
  { sfid: '0017000000Vb80wAAB', name: 'Alchemer LLC (fka SurveyGizmo)', products: ["Billing"] },
  { sfid: '0017000001RA0w8AAD', name: 'Guru', products: ["Billing"] },
  { sfid: '0017000001Qi3avAAB', name: 'Crunchbase, Inc.', products: ["Billing"] },
  { sfid: '0017000000wZUg3AAG', name: '66degrees', products: ["Billing","RevPro"] },
  { sfid: '0017000000rFyeMAAS', name: 'Inmar, Inc.', products: ["RevPro"] },
  { sfid: '0017000000ttElrAAE', name: 'Yesware, Inc.', products: ["Billing"] },
  { sfid: '001Po00000Aan4VIAR', name: 'Turf Tank', products: ["Billing","RevPro"] },
  { sfid: '0014u00001vTNBOAA4', name: 'American Residential Warranty', products: ["Billing"] },
  { sfid: '0017000000oVonaAAC', name: 'WABTEC: WESTINGHOUSE AIR BRAKE TECHNOLOGIES CORPORATION', products: ["Billing"] },
  { sfid: '0010g00001Yco87AAB', name: 'Brunswick News, a division of Postmedia Network Inc.', products: ["Billing"] },
  { sfid: '00170000016brquAAA', name: 'Atmosera (EasyStreet)', products: ["Billing"] },
  { sfid: '0017000000mNamkAAC', name: 'TeamSnap', products: ["Billing"] },
  { sfid: '0017000001Dmh8SAAR', name: 'Branch Metrics', products: ["Billing"] },
  { sfid: '0017000000tv6QnAAI', name: 'TrackVia', products: ["Billing"] },
  { sfid: '0017000000kmnDbAAI', name: 'Placester, Inc.', products: ["Billing"] },
  { sfid: '0017000001LNlzPAAT', name: 'Icertis', products: ["RevPro"] },
  { sfid: '0010g00001eOWh8AAG', name: 'Asset Panda', products: ["Billing"] },
  { sfid: '0017000000uJA2fAAG', name: 'PhotoShelter, Inc.', products: ["Billing"] },
  { sfid: '0017000000zWLkyAAG', name: 'ReviewTrackers', products: ["Billing"] },
  { sfid: '0017000000UzfsmAAB', name: 'Topcon Positioning Systems, Inc.', products: ["Billing"] },
  { sfid: '0017000001SOWUsAAP', name: 'Broadly', products: ["Billing"] },
  { sfid: '0014u00001pxv6QAAQ', name: 'A10 Networks, Inc.', products: ["RevPro"] },
  { sfid: '0014u00001vUJx0AAG', name: 'Otter.ai, Inc', products: ["Billing"] },
  { sfid: '0017000000nvHSeAAM', name: 'Convoso', products: ["Billing"] },
  { sfid: '0014u00001zp8DIAAY', name: 'Sporting Media USA Inc.', products: ["Zephr"] },
  { sfid: '0014u0000234jC1AAI', name: 'PESI Inc. dba Psychotherapy Networker', products: ["Zephr"] },
  { sfid: '0014u00001zlzDTAAY', name: 'New England Newspapers, Inc.', products: ["Zephr"] },
  { sfid: '0017000000xKYBZAA4', name: 'Leafly, LLC', products: ["Billing"] },
  { sfid: '0017000001TL8jKAAT', name: 'Association of Certified Fraud Examiners', products: ["Billing"] },
  { sfid: '00170000014hec7AAA', name: 'Canopy Tax', products: ["Billing"] },
  { sfid: '0017000000kkXfGAAU', name: 'TechSmith Corporation', products: ["Billing"] },
  { sfid: '0017000000ngsw7AAA', name: 'Authentic8, Inc.', products: ["Billing"] },
  { sfid: '00170000015U9bkAAC', name: 'Akerna Corp (fka MJ Freeway)', products: ["Billing"] },
  { sfid: '0017000000rx8mIAAQ', name: 'International Air Transportation Association (IATA)', products: ["Billing"] },
  { sfid: '0017000000ozCbnAAE', name: 'International Risk Management Institute, Inc.', products: ["Billing"] },
  { sfid: '0010g00001XaVI1AAN', name: 'UPKEEP TECHNOLOGIES, INC', products: ["Billing"] },
  { sfid: '0017000000kkYUeAAM', name: 'Editshare, LLC', products: ["Billing"] },
  { sfid: '0017000000j2pYoAAI', name: 'Omni Technology Solutions Inc', products: ["Billing"] },
  { sfid: '0017000000QO9B4AAL', name: 'Texbase', products: ["Billing"] },
  { sfid: '0017000000pm9KJAAY', name: 'Alchemy Systems', products: ["Billing"] },
  { sfid: '0017000001TLW8SAAX', name: 'InfluxData Inc.', products: ["Billing"] },
  { sfid: '0010g00001m5FTXAA2', name: 'Deloitte LLP', products: ["Billing"] },
  { sfid: '0017000000mNirEAAS', name: 'Devex', products: ["Billing"] },
  { sfid: '00170000012xnHyAAI', name: 'Pingboard, Inc.', products: ["Billing"] },
  { sfid: '0010g00001f6L2kAAE', name: 'Worksuite, LLC', products: ["Billing"] },
  { sfid: '00170000014fI1lAAE', name: 'Readdle', products: ["Billing"] },
  { sfid: '0017000000klypeAAA', name: 'Enverus Inc. (fka Cortex Business Solutions)', products: ["Billing"] },
  { sfid: '0017000001UuShxAAF', name: 'Control Play Inc (formerly 787Networks)', products: ["Billing"] },
  { sfid: '0010g00001b8X5cAAE', name: 'Dor Technologies', products: ["Billing"] },
  { sfid: '0017000001OOWBBAA5', name: 'Aims 360', products: ["Billing"] },
  { sfid: '0017000000S7LI5AAN', name: 'Data Doctors Quality Care, LLC', products: ["Billing"] },
  { sfid: '0017000000koD1zAAE', name: 'Venn Inc (fka OS33)', products: ["Billing"] },
  { sfid: '0017000000vwUUzAAM', name: 'Convirza', products: ["Billing"] },
  { sfid: '0017000000dJGzAAAW', name: 'NorthStar Travel Media, LLC', products: ["Billing"] },
  { sfid: '0017000001IFGK1AAP', name: 'Antylia Scientific', products: ["Billing"] },
  { sfid: '0010g00001ZL81JAAT', name: 'BTS USA, Inc. fka Rapid Learning Institute', products: ["Billing"] },
  { sfid: '0017000001UwQFMAA3', name: 'Elevat Inc.', products: ["Billing"] },
  { sfid: '001Po000001JbpiIAC', name: 'Remote Lock', products: ["Billing"] },
  { sfid: '0017000000MHAlqAAH', name: 'Hiremojo', products: ["Billing"] },
  { sfid: '0017000000mPtyUAAS', name: 'Service Noodle', products: ["Billing"] },
  { sfid: '0017000000yWLrNAAW', name: 'AIB, Inc.', products: ["Billing"] },
  { sfid: '0014u00001txy3UAAQ', name: 'PureSky Community Solar Inc.', products: ["Billing"] },
  { sfid: '0017000001LMiruAAD', name: 'Iterable, Inc.', products: ["Billing"] },
  { sfid: '0014u0000249YQFAA2', name: 'The Wrap News Inc.', products: ["Zephr"] },
  { sfid: '0017000000qgIXjAAM', name: 'Rubicon Global', products: ["Billing"] },
  { sfid: '0017000000wY6ZuAAK', name: 'SiteCompli, LLC', products: ["Billing"] },
  { sfid: '0017000001SZVPRAA5', name: 'Kindful', products: ["Billing"] },
  { sfid: '0017000000kn3q6AAA', name: 'Dynata, LLC. (fka MarketSight)', products: ["Billing"] },
  { sfid: '0010g00001iU0eZAAS', name: 'OpenSpace', products: ["Billing","RevPro"] },
  { sfid: '0017000000qgI72AAE', name: 'Gfi USA LLC', products: ["Billing"] },
  { sfid: '0010g00001d4mbEAAQ', name: 'Dental Intelligence', products: ["Billing"] },
  { sfid: '0017000001OOC40AAH', name: 'SolveiQ', products: ["Billing"] },
  { sfid: '0017000000lceMKAAY', name: 'WorthPoint Corporation', products: ["Billing"] },
  { sfid: '0017000000uJ9wgAAC', name: 'JW Player', products: ["Billing","RevPro"] },
  { sfid: '0017000000rw8sAAAQ', name: 'Medrio', products: ["Billing"] },
  { sfid: '0017000000rHCoqAAG', name: 'SumUp, Inc.', products: ["Billing"] },
  { sfid: '0010g00001Xa6j5AAB', name: 'YMCA of Central Florida Metro', products: ["Billing"] },
  { sfid: '0017000001LQD6rAAH', name: 'Karbon FKA PracticeIQ', products: ["Billing"] },
  { sfid: '0017000000YRzPeAAL', name: 'iQmetrix Software Development Corp.', products: ["Billing"] },
  { sfid: '0017000000V0dAXAAZ', name: 'Digital Air Strike', products: ["Billing"] },
  { sfid: '0017000000n679XAAQ', name: 'Zello', products: ["Billing"] },
  { sfid: '0017000001UwJG6AAN', name: 'Energage (f.k.a. WorkplaceDynamics)', products: ["Billing"] },
  { sfid: '0017000001SOWVvAAP', name: 'Kustomer, LLC.', products: ["Billing"] },
  { sfid: '0017000001MQ6kuAAD', name: 'LeanTaaS', products: ["Billing","RevPro"] },
  { sfid: '0017000000poDX2AAM', name: 'Talkdesk', products: ["Billing"] },
  { sfid: '0017000000WGnnXAAT', name: 'Armor', products: ["Billing"] },
  { sfid: '0017000000uJ9tYAAS', name: 'Imagine Communications, Inc.', products: ["RevPro"] },
  { sfid: '0017000000k32cPAAQ', name: 'Urban Science Applications Inc.', products: ["Billing","RevPro"] },
  { sfid: '0017000000mPdrmAAC', name: 'Buildscale, Inc. (dba Vidyard)', products: ["Billing"] },
  { sfid: '001Po0000013LKHIA2', name: 'Home Care Pulse', products: ["Billing"] },
  { sfid: '001Po00000DKnZoIAL', name: 'Finale Inventory', products: ["Billing"] },
  { sfid: '0014u00001zmSSOAA2', name: 'Stenograph LLC', products: ["Billing"] },
  { sfid: '0010g00001gxTl9AAE', name: 'ZenQMS', products: ["Billing"] },
  { sfid: '0017000000RGTNfAAP', name: 'Zetta, Inc', products: ["Billing"] },
  { sfid: '0017000001TKsZFAA1', name: 'Fender Musical Instruments Corporation', products: ["Billing"] },
  { sfid: '0017000000lajrNAAQ', name: 'DataStax', products: ["RevPro"] },
  { sfid: '0017000000vv156AAA', name: 'View The Space, Inc.', products: ["RevPro"] },
  { sfid: '001Po00000CIlpZIAT', name: 'Underline Technologies, LLC', products: ["Billing"] },
  { sfid: '0017000000zY5YIAA0', name: 'Maxwell Health', products: ["Billing"] },
  { sfid: '0017000000tu74KAAQ', name: 'Teledyne FLIR, LLC', products: ["Billing"] },
  { sfid: '001700000192ydCAAQ', name: '<a href=http://sync.com>Sync.com</a>', products: ["Billing"] },
  { sfid: '0017000000MH2FGAA1', name: 'Trimble Inc.', products: ["RevPro"] },
  { sfid: '0017000001KveqEAAR', name: 'MarginEdge', products: ["Billing"] },
  { sfid: '0010g00001iSEpPAAW', name: 'Science News', products: ["Zephr"] },
  { sfid: '0014u0000249LB9AAM', name: 'The San Francisco Standard', products: ["Zephr"] },
  { sfid: '0017000000k1NzMAAU', name: 'unWired Broadband LLC', products: ["Billing"] },
  { sfid: '0014u00001mtcpDAAQ', name: 'smartBeemo', products: ["Billing"] },
  { sfid: '0017000000zwZsGAAU', name: 'PropertyVista', products: ["Billing"] },
  { sfid: '0017000000tRiXcAAK', name: 'Mavenlink', products: ["Billing"] },
  { sfid: '0017000000kmr2xAAA', name: 'RPost, Inc.', products: ["Billing"] },
  { sfid: '0017000000qgIR7AAM', name: 'Simpleview Inc (DTN BU uses Zuora)', products: ["Billing"] },
  { sfid: '0014u00001twlSRAAY', name: 'Data Processing Design Inc', products: ["Billing"] },
  { sfid: '001Po00000jq8duIAA', name: 'Amazing Life', products: ["Billing"] },
  { sfid: '001Po00000BoKwXIAV', name: 'Point One Navigation', products: ["Billing"] },
  { sfid: '0017000000kmGmKAAU', name: 'Bamboo Rose', products: ["Billing"] },
  { sfid: '0017000000mOrisAAC', name: 'TitanFile Inc.', products: ["Billing"] },
  { sfid: '0017000001QzjnGAAR', name: 'True North Loyalty, LLC', products: ["Billing"] },
  { sfid: '0017000000TZ5noAAD', name: 'Focus-N-Fly, Inc.', products: ["Billing"] },
  { sfid: '0017000000ZJsEVAA1', name: 'BI Incorporated', products: ["Billing"] },
  { sfid: '0017000000vx5bIAAQ', name: 'Johnson Controls Inc', products: ["Billing"] },
  { sfid: '0017000000pRVDbAAO', name: 'PubNub Inc', products: ["Billing"] },
  { sfid: '0010g00001jmFQyAAM', name: 'Kandji', products: ["Billing"] },
  { sfid: '0014u0000234xynAAA', name: 'Flowcode', products: ["Billing","RevPro"] },
  { sfid: '0017000000tt8WqAAI', name: 'SWIS - University of Oregon', products: ["Billing"] },
  { sfid: '0010g00001iTABzAAO', name: 'Mobials Inc', products: ["Billing"] },
  { sfid: '0017000000pmTk9AAE', name: 'FuneralOne', products: ["Billing"] },
  { sfid: '0014u00001txd9iAAA', name: 'Secureframe', products: ["Billing"] },
  { sfid: '0017000000kllkeAAA', name: 'Couchbase Inc.', products: ["RevPro"] },
  { sfid: '0017000000qgMwZAAU', name: 'Global VetLINK', products: ["Billing"] },
  { sfid: '0014u00001zpTs8AAE', name: 'Washington Newspaper Publishing Co, LLC', products: ["Zephr"] },
  { sfid: '0017000001TL5W3AAL', name: 'Acceo Solutions Inc. (dakis division)', products: ["Billing"] },
  { sfid: '0010g00001cVNjCAAW', name: 'Luminary Media', products: ["Billing"] },
  { sfid: '0017000000jHO9aAAG', name: 'Brightedge Technologies, Inc.', products: ["Billing"] },
  { sfid: '0017000000PnYd7AAF', name: 'Engageware', products: ["Billing"] },
  { sfid: '0010g00001ZEV2iAAH', name: 'Dealers United LLC', products: ["Billing"] },
  { sfid: '001700000195XqVAAU', name: 'Missional Marketing', products: ["Billing"] },
  { sfid: '0010g00001iSDmFAAW', name: 'RSA Conference LLC', products: ["Billing"] },
  { sfid: '0017000000xHpkSAAS', name: 'Contentsquare INC', products: ["Billing"] },
  { sfid: '0017000000vwN9pAAE', name: 'Customer Focus Software', products: ["Billing"] },
  { sfid: '0010g00001aLjB5AAK', name: 'Traxxall', products: ["Billing"] },
  { sfid: '0017000000rx7dOAAQ', name: 'Funnel Leasing, INC', products: ["Billing"] },
  { sfid: '0017000001OO2qWAAT', name: 'Perkville (Restart)', products: ["Billing"] },
  { sfid: '0017000000uJl6eAAC', name: 'Tampa Bay Times - Times Publishing Co', products: ["Zephr"] },
  { sfid: '0017000000Udec8AAB', name: 'The Dun &amp; Bradstreet Corporation', products: ["RevPro"] },
  { sfid: '0017000000kmGLLAA2', name: 'Xactware Solutions, Inc.', products: ["Billing","Collections"] },
  { sfid: '0017000000nsK5TAAU', name: 'Avetta', products: ["Billing","RevPro"] },
  { sfid: '0017000001Ux3PPAAZ', name: 'Donnelley Financial LLC', products: ["Billing","RevPro"] },
  { sfid: '0017000001KueJdAAJ', name: 'UL Verification Services Inc', products: ["Billing"] },
  { sfid: '0017000001MQ3ldAAD', name: 'Gaia', products: ["Billing"] },
  { sfid: '0017000000bF05vAAC', name: 'Forcepoint LLC', products: ["RevPro"] },
  { sfid: '0017000000uJ9b7AAC', name: 'Rev.com, Inc.', products: ["Billing","Collections"] },
  { sfid: '0017000000lch9QAAQ', name: 'eVestment Alliance, LLC', products: ["Billing"] },
  { sfid: '0017000000vx5c0AAA', name: 'Generac Power Systems, Inc.', products: ["Billing"] },
  { sfid: '0017000000WlUMmAAN', name: 'Compulink Management Center, Inc. dba Laserfiche', products: ["Billing"] },
  { sfid: '0017000000twvUAAAY', name: 'Act! (fka Swiftpage)', products: ["Billing"] },
  { sfid: '0017000000nsQUoAAM', name: 'Qualys', products: ["RevPro"] },
  { sfid: '0017000001TKu6LAAT', name: 'OfferUp', products: ["Billing"] },
  { sfid: '0017000000rIMomAAG', name: 'Dorsey Wright and Associates, LLC.', products: ["Billing"] },
  { sfid: '00170000013jgJfAAI', name: 'iRobot Corporation', products: ["Billing","RevPro"] },
  { sfid: '0017000000nsOR5AAM', name: 'ForeScout Technologies, Inc.', products: ["RevPro"] },
  { sfid: '0010g00001mLHpkAAG', name: 'Canon Inc', products: ["Billing"] },
  { sfid: '0017000000YUyGGAA1', name: 'Keysight Technologies Inc', products: ["RevPro"] },
  { sfid: '0014u00001noSqBAAU', name: 'Braze Inc. (Restart)', products: ["RevPro"] },
  { sfid: '0010g00001aKNYnAAO', name: 'Swing Education, Inc.', products: ["Billing","Collections"] },
  { sfid: '0017000000tvZlhAAE', name: 'Aviat U.S., Inc.', products: ["RevPro"] },
  { sfid: '0017000000jbD00AAE', name: 'Vocera Communications Inc', products: ["RevPro"] },
  { sfid: '0017000001Xwm4LAAR', name: 'Petvisor Holdings, LLC', products: ["Billing"] },
  { sfid: '0017000000nsOQzAAM', name: 'Delinea, Inc.', products: ["RevPro"] },
  { sfid: '0017000000WGwFUAA1', name: 'Arista Networks, Inc.', products: ["Billing"] },
  { sfid: '0017000000MGGIbAAP', name: 'Demandforce, Inc.', products: ["Billing"] },
  { sfid: '0017000000bEvkPAAS', name: 'Canon U.S.A., Inc.', products: ["Billing"] },
  { sfid: '0010g00001lEwSYAA0', name: 'Ekata, Inc.', products: ["Billing"] },
  { sfid: '0010g00001aLDKsAAO', name: 'inContact', products: ["Billing"] },
  { sfid: '0017000000nsQZpAAM', name: 'Dark Matter Technologies, Inc.', products: ["Billing","RevPro"] },
  { sfid: '0017000000lcbknAAA', name: 'Open Education LLC.', products: ["Billing"] },
  { sfid: '0017000000vxCZCAA2', name: 'Wondrium (Teaching Company)', products: ["Billing"] },
  { sfid: '0017000000mQL9TAAW', name: 'Quest Diagnostics Healthcare IT Solutions (formerly MedPlus)', products: ["Billing","RevPro"] },
  { sfid: '0017000000oVQXEAA4', name: 'Hireology LLC', products: ["Billing","RevPro"] },
  { sfid: '0017000000nsM9hAAE', name: 'Activeprospect', products: ["Billing","RevPro"] },
  { sfid: '0017000000uJAERAA4', name: 'Valant Medical Solutions Inc.', products: ["Billing"] },
  { sfid: '0010g00001dg1s1AAA', name: '<a href=http://honeycomb.io>Honeycomb.io</a>', products: ["RevPro"] },
  { sfid: '0017000000PnYdjAAF', name: 'Aabaco Small Business, LLC', products: ["Billing"] },
  { sfid: '0010g00001lF7MRAA0', name: 'Plastic Research and Development Corporation (PRADCO)', products: ["Billing"] },
  { sfid: '0010g00001eOz5GAAS', name: 'Indigo Parc Canada Inc.and LAZ Karp Associates, LLC', products: ["Billing"] },
  { sfid: '0014u00001pxMOjAAM', name: 'Elm Street Technology, LLC', products: ["Billing"] },
  { sfid: '0017000000vuva4AAA', name: 'Zengine Ltd fka IntelliCentrics Inc.', products: ["Billing"] },
  { sfid: '0017000000zYdfmAAC', name: 'GoCanvas', products: ["Billing"] },
  { sfid: '0017000000nsWttAAE', name: 'ADTRAN, Inc.', products: ["Billing","RevPro"] },
  { sfid: '0010g00001ewAnzAAE', name: 'Perch Energy, LLC', products: ["Billing"] },
  { sfid: '0017000000k3gbrAAA', name: 'Tune', products: ["Billing"] },
  { sfid: '0017000000plr27AAA', name: 'Telestream', products: ["Billing"] },
  { sfid: '0017000000SyJ0JAAV', name: 'Voya Services Company (fka Benefitfocus.com, Inc)', products: ["Billing"] },
  { sfid: '0017000000nsNgdAAE', name: 'Peaksware', products: ["Billing"] },
  { sfid: '0010g00001mMSldAAG', name: 'Cricut, Inc.', products: ["RevPro"] },
  { sfid: '0017000001BftldAAB', name: 'Kintone', products: ["Billing"] },
  { sfid: '0017000000po1PJAAY', name: 'Gainsight', products: ["RevPro"] },
  { sfid: '0017000000rmycIAAQ', name: 'Splashtop Inc.', products: ["Billing"] },
  { sfid: '0017000000nupcoAAA', name: 'Teads Holding Co.', products: ["Billing"] },
  { sfid: '0017000000Wkqe8AAB', name: 'Celartem, Inc.', products: ["Billing"] },
  { sfid: '0017000000zXxvAAAS', name: 'Real Estate Webmasters', products: ["Billing"] },
  { sfid: '0017000000nsLT8AAM', name: 'Bitly, Inc.', products: ["Billing"] },
  { sfid: '0017000000SZ9UWAA1', name: 'RealNetworks LLC', products: ["Billing"] },
  { sfid: '0017000000nsR6HAAU', name: 'Tripwire, Inc.', products: ["Billing","RevPro"] },
  { sfid: '0010g00001gOU7OAAW', name: 'Malwarebytes, Inc. (restart)', products: ["RevPro"] },
  { sfid: '0017000000bEzOcAAK', name: 'Bentley Systems, Incorporated', products: ["RevPro"] },
  { sfid: '0010g00001XaMYBAA3', name: 'OVH US LLC', products: ["Billing"] },
  { sfid: '00170000013jHgYAAU', name: 'DaySmart Software', products: ["Billing","RevPro"] },
  { sfid: '00170000012S1QPAA0', name: 'Omnitracs, LLC', products: ["RevPro"] },
  { sfid: '0017000000nisVPAAY', name: 'Appointment Plus', products: ["Billing"] },
  { sfid: '0017000000mODTHAA4', name: 'Commerce.com US, Inc', products: ["Billing","RevPro"] },
  { sfid: '0017000001OO3kQAAT', name: 'Delta Defense, LLC', products: ["Billing"] },
  { sfid: '0017000000la1nYAAQ', name: 'Paycor, Inc.', products: ["Billing"] },
  { sfid: '0017000000uJA2uAAG', name: 'Pipedrive, Inc.', products: ["Billing","RevPro"] },
  { sfid: '0017000001UuFR8AAN', name: 'EverCommerce Solutions Inc.', products: ["Billing","RevPro"] },
  { sfid: '0017000000T09HIAAZ', name: 'SurePayroll', products: ["Billing"] },
  { sfid: '0017000000q8ZxyAAE', name: 'BambooHR LLC', products: ["Billing"] },
  { sfid: '0017000000nsLw1AAE', name: 'SAMBA Holdings, Inc.', products: ["Billing"] },
  { sfid: '0010g00001XaNZNAA3', name: 'Veriforce', products: ["Billing"] },
  { sfid: '0010g00001ZL1zEAAT', name: 'Hitachi Vantara', products: ["RevPro"] },
  { sfid: '0017000000kmH3SAAU', name: 'Relativity ODA LLC', products: ["Billing","RevPro"] },
  { sfid: '00170000018IiUTAA0', name: 'Weiss Ratings, LLC', products: ["Billing"] },
  { sfid: '0017000000TtEsEAAV', name: 'Wowza Media Systems', products: ["Billing","RevPro"] },
  { sfid: '0017000000zyDA8AAM', name: 'FPL Energy Services, Inc.', products: ["Billing"] },
];

const daysAgoIso = (d: number) =>
  new Date(Date.now() - d * 86400 * 1000).toISOString();
const daysAheadIso = (d: number) =>
  new Date(Date.now() + d * 86400 * 1000).toISOString();
const dateOnly = (iso: string) => iso.slice(0, 10);

const allFalse: CerebroRisks = {
  utilizationRisk: false,
  engagementRisk: false,
  suiteRisk: false,
  shareRisk: false,
  legacyTechRisk: false,
  expertiseRisk: false,
  pricingRisk: false,
};

function sfdcLinks(name: string, sfid: string): SourceLink[] {
  return [
    {
      source: 'salesforce',
      label: 'SFDC Account',
      url: `https://zuora.lightning.force.com/lightning/r/Account/${sfid}/view`,
    },
    {
      source: 'cerebro',
      label: 'Cerebro (via Glean)',
      url: `https://app.glean.com/search?q=${encodeURIComponent(name + ' Cerebro Risk')}`,
    },
    {
      source: 'gainsight',
      label: 'Gainsight Company',
      url: `https://zuora.gainsightcloud.com/v1/ui/cs#/360/${sfid}`,
    },
  ];
}

interface Build {
  id: string;
  sfid: string;
  name: string;
  sentiment: CSESentiment;
  cerebroRisk: CerebroRiskCategory;
  cerebroRisks: CerebroRisks;
  arr: number;
  products: string[];
  cseName: string;
  ownerName: string;
  commentary: string;
  commentaryDaysAgo: number;
  riskAnalysis: string | null;
  subMetrics?: Record<string, number | string | boolean | null>;
  workshops?: { date: string; type?: string }[];
  meetings?: { source: 'calendar' | 'zoom' | 'staircase'; title: string; daysAgo: number }[];
  tasks?: { title: string; status: string; dueDaysAhead?: number; ownerName?: string }[];
  opps: {
    id: string;
    name: string;
    type: string;
    stage: string;
    stageNum: number;
    closeDaysAhead: number;
    acv?: number;
    atr?: number;
    forecastMostLikely?: number;
    confidence?: CanonicalOpportunity['mostLikelyConfidence'];
    hedge?: number;
    acvDelta?: number;
    knownChurn?: number;
    productLine?: string;
    flmNotes?: string;
    scNextSteps?: string;
    salesEngineerName?: string | null;
    fullChurnNotificationToOwnerDate?: string | null;
    fullChurnFinalEmailSentDate?: string | null;
    churnDownsellReason?: string | null;
  }[];
  isConfirmedChurn?: boolean;
  churnReason?: string;
  churnReasonSummary?: string;
  churnDate?: string;
}

function buildAccount(
  b: Build,
): { account: CanonicalAccount; opportunities: CanonicalOpportunity[] } {
  const links = sfdcLinks(b.name, b.sfid);
  const account: CanonicalAccount = {
    accountId: b.sfid,
    salesforceAccountId: b.sfid.slice(0, 15),
    accountName: b.name,
    zuoraTenantId: `tenant-${b.id}`,
    accountOwner: { id: 'U-OWN-' + b.id, name: b.ownerName },
    assignedCSE: { id: 'U-CSE-' + b.id, name: b.cseName },
    csCoverage: 'CSE',
    franchise: FRANCHISE,
    cseSentiment: b.sentiment,
    cseSentimentCommentary: b.commentary,
    cseSentimentLastUpdated: daysAgoIso(b.commentaryDaysAgo),
    cseSentimentCommentaryLastUpdated: daysAgoIso(b.commentaryDaysAgo),
    cerebroRiskCategory: b.cerebroRisk,
    cerebroRiskAnalysis: b.riskAnalysis,
    cerebroRisks: b.cerebroRisks,
    cerebroSubMetrics: b.subMetrics ?? {},
    allTimeARR: b.arr,
    activeProductLines: b.products,
    engagementMinutes30d: 60 + (b.id.length % 5) * 30,
    engagementMinutes90d: 200 + (b.id.length % 5) * 80,
    isConfirmedChurn: b.isConfirmedChurn ?? b.sentiment === 'Confirmed Churn',
    churnReason: b.churnReason ?? null,
    churnReasonSummary: b.churnReasonSummary ?? null,
    churnDate: b.churnDate ?? null,
    gainsightTasks: (b.tasks ?? []).map((t, i) => ({
      id: `T-${b.id}-${i}`,
      title: t.title,
      owner: t.ownerName ? { id: 'U-OWN-' + b.id, name: t.ownerName } : null,
      dueDate: t.dueDaysAhead != null ? daysAheadIso(t.dueDaysAhead).slice(0, 10) : null,
      status: t.status,
      ctaId: `CTA-${b.id}-${i}`,
    })),
    workshops: (b.workshops ?? []).map((w, i) => ({
      id: `W-${b.id}-${i}`,
      engagementType: w.type ?? 'Quarterly Workshop',
      status: 'Completed',
      workshopDate: w.date,
    })),
    recentMeetings: (b.meetings ?? []).map((m) => ({
      source: m.source,
      title: m.title,
      startTime: daysAgoIso(m.daysAgo),
      attendees: ['nick.wilbur@zuora.com', 'customer@example.com'],
      summary: `Auto-summary: ${m.title}`,
      url: null,
    })),
    accountPlanLinks: [
      {
        title: `${b.name} — Account Plan`,
        url: `https://docs.google.com/document/d/${b.id}-plan`,
        lastModified: daysAgoIso(20),
      },
    ],
    sourceLinks: links,
    lastUpdated: new Date().toISOString(),
  };

  const opportunities: CanonicalOpportunity[] = b.opps.map((o) => {
    // Generate a Salesforce-shaped 18-char opportunity ID (starts with 006).
    // Deterministic per (account index, opp suffix) so refreshes are stable.
    const sfOppId = ('006Mock' + b.id + o.id.replace(/[^A-Za-z0-9]/g, '')).slice(0, 18).padEnd(18, 'A');
    return {
    opportunityId: sfOppId,
    opportunityName: o.name,
    accountId: b.sfid,
    type: o.type,
    stageName: o.stage,
    stageNum: o.stageNum,
    closeDate: dateOnly(daysAheadIso(o.closeDaysAhead)),
    closeQuarter: ((): string => {
      const m = new Date(daysAheadIso(o.closeDaysAhead)).getMonth();
      return ['Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q3', 'Q3', 'Q3', 'Q4', 'Q4', 'Q4'][m]!;
    })(),
    fiscalYear: new Date(daysAheadIso(o.closeDaysAhead)).getFullYear(),
    acv: o.acv ?? null,
    availableToRenewUSD: o.atr ?? null,
    forecastMostLikely: o.forecastMostLikely ?? null,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: o.confidence ?? 'Medium',
    forecastHedgeUSD: o.hedge ?? null,
    acvDelta: o.acvDelta ?? 0,
    knownChurnUSD: o.knownChurn ?? 0,
    productLine: o.productLine ?? null,
    flmNotes: o.flmNotes ?? '',
    slmNotes: null,
    scNextSteps: o.scNextSteps ?? '',
    salesEngineer:
      o.salesEngineerName === undefined
        ? { id: 'U-CSE-' + b.id, name: b.cseName }
        : o.salesEngineerName === null
          ? null
          : { id: 'U-SE-' + b.id, name: o.salesEngineerName },
    fullChurnNotificationToOwnerDate: o.fullChurnNotificationToOwnerDate ?? null,
    fullChurnFinalEmailSentDate: o.fullChurnFinalEmailSentDate ?? null,
    churnDownsellReason: o.churnDownsellReason ?? null,
    sourceLinks: [
      {
        source: 'salesforce',
        label: 'SFDC Opportunity',
        url: `https://zuora.lightning.force.com/lightning/r/Opportunity/${sfOppId}/view`,
      },
    ],
    lastUpdated: new Date().toISOString(),
    };
  });

  return { account, opportunities };
}

const builds: Build[] = REAL_EXPAND_3_ACCOUNTS.map((acc, i) => ({
  id: String(i + 1).padStart(2, '0'),
  sfid: acc.sfid,
  name: acc.name,
  sentiment: i === 0 ? 'Confirmed Churn' : i === 1 ? 'Red' : 'Green',
  cerebroRisk: i === 0 ? 'Critical' : i === 1 ? 'High' : 'Low',
  cerebroRisks: i === 0 ? { ...allFalse, utilizationRisk: true, engagementRisk: true, shareRisk: true, pricingRisk: true } : allFalse,
  arr: 500_000 + i * 100_000,
  products: acc.products,
  cseName: ['Christopher Franklin-Hollier', 'Sneha Stephen', 'Shwetha Ravindran', 'Kiran Rajan', 'Mahalakshmi Krishnan', 'Jayaram Iyer'][i % 6],
  ownerName: 'Brandon LaTourelle',
  commentary: i === 0 ? 'STATE AND RENEWAL RISK: Monitoring for potential consolidation risks.\nACTION PLAN: Increase executive engagement; ensure value realization.' : 'Customer engagement stable. Regular quarterly business reviews scheduled.',
  commentaryDaysAgo: 7 + i,
  riskAnalysis: null,
  subMetrics: {},
  workshops: i % 2 === 0 ? [{ date: daysAgoIso(90) }] : [],
  meetings: [{ source: 'zoom', title: 'Quarterly Business Review', daysAgo: 14 + i * 7 }],
  isConfirmedChurn: i === 0,
  churnReason: i === 0 ? 'Competitive Pressure' : undefined,
  churnReasonSummary: i === 0 ? 'Considering competitor due to pricing concerns.' : undefined,
  churnDate: i === 0 ? daysAheadIso(90).slice(0, 10) : undefined,
  opps: [
    {
      id: `OPP-${i + 1}-RENEWAL`,
      name: `${acc.name} FY27 Renewal`,
      type: 'Renewal',
      stage: i === 0 ? 'Closed Lost' : i === 1 ? 'Negotiation' : 'Qualification',
      stageNum: i === 0 ? 9 : i === 1 ? 6 : 2,
      closeDaysAhead: 90 + i * 30,
      acv: 500_000 + i * 100_000,
      atr: 500_000 + i * 100_000,
      forecastMostLikely: i === 0 ? 0 : 500_000 + i * 100_000,
      confidence: i === 1 ? 'High' : 'Medium',
      hedge: i === 1 ? 50_000 : 0,
      acvDelta: 0,
      knownChurn: i === 0 ? 500_000 + i * 100_000 : 0,
      productLine: acc.products[0],
      flmNotes: '',
      scNextSteps: i === 1 ? 'Schedule executive meeting to discuss renewal terms.' : '',
      // Per-opportunity Sales Engineer (NOT inherited from account.assignedCSE).
      // Rotates through real CSE names so the opp-level SE is distinct from the account CSE.
      salesEngineerName: ['Kiran Rajan', 'Shwetha Ravindran', 'Mahalakshmi Krishnan', 'Sneha Stephen', 'Thais Pagliaricci', 'Kyle Larkin'][i % 6],
      fullChurnNotificationToOwnerDate: i === 0 ? daysAgoIso(14).slice(0, 10) : null,
      fullChurnFinalEmailSentDate: i === 0 ? daysAgoIso(7).slice(0, 10) : null,
      churnDownsellReason: i === 0 ? 'Pricing' : null,
    },
  ],
}));

export function getMockData(): {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
} {
  const accounts: CanonicalAccount[] = [];
  const opportunities: CanonicalOpportunity[] = [];
  for (const b of builds) {
    const { account, opportunities: opps } = buildAccount(b);
    accounts.push(account);
    opportunities.push(...opps);
  }
  return { accounts, opportunities };
}

// For week-over-week, produce a "prior" snapshot with simulated changes so two refreshes
// against mocks yield non-empty WoW.
export function getMockDataPrior(): {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
} {
  const { accounts, opportunities } = getMockData();
  // Mutate the prior version so current vs prior diff is non-empty.
  const prior = {
    accounts: accounts.map((a) => ({ ...a, workshops: [...a.workshops], cerebroRisks: { ...a.cerebroRisks } })),
    opportunities: opportunities.map((o) => ({ ...o })),
  };

  // Helios (02): prior risk High → currently Critical
  const helios = prior.accounts.find((a) => a.accountId === '0010000000000002AAA');
  if (helios) helios.cerebroRiskCategory = 'High';

  // Bridgewater (03): prior sentiment Yellow → currently Red
  const bw = prior.accounts.find((a) => a.accountId === '0010000000000003AAA');
  if (bw) bw.cseSentiment = 'Yellow';

  // Kestrel (04): prior had no recent workshop; current has one → workshop added this week
  const kestrel = prior.accounts.find((a) => a.accountId === '0010000000000004AAA');
  if (kestrel) kestrel.workshops = [];

  // Lumen Zephr (06): prior stage Stage 2; current Stage 3
  const lumenZephr = prior.opportunities.find((o) => o.opportunityId === 'OPP-06-UP');
  if (lumenZephr) {
    lumenZephr.stageName = 'Stage 2 - Discovery';
    lumenZephr.stageNum = 2;
    lumenZephr.forecastMostLikely = 150_000;
  }

  // Northwind (01): prior had no churn notice date
  const nw = prior.opportunities.find((o) => o.opportunityId === 'OPP-01-CHURN');
  if (nw) {
    nw.fullChurnNotificationToOwnerDate = null;
    nw.fullChurnFinalEmailSentDate = null;
  }

  // Pinecrest (12): prior had cerebroRisks.engagementRisk false → currently true
  const pine = prior.accounts.find((a) => a.accountId === '0010000000000012AAA');
  if (pine) pine.cerebroRisks = { ...pine.cerebroRisks, engagementRisk: false };

  return prior;
}
