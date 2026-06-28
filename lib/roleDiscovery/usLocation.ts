// US-location heuristic for role discovery. The product assumes US work authorization (the resume
// builder even stamps "Authorized to work in the U.S."), and the seed boards hire globally, so by
// default discovery should drop clearly-non-US postings. Free-text `location` is messy
// ("US Remote", "Seattle, WA", "Sydney, Australia", "Remote - EMEA"), so this is a heuristic, not a
// parser: BIAS TOWARD KEEPING — only drop a posting that names a clearly non-US place and gives no
// US signal. "Remote" / unknown / unrecognized → kept (US-eligible).

// A US signal: "US"/"USA"/"United States", a US state name, or a major US metro. If present, keep
// even when a non-US place is also mentioned (e.g. "San Francisco or London") — bias toward keeping.
const US_HINT_RE = new RegExp(
  '\\b(' +
    'u\\.?s\\.?a?|united states|' +
    // states + DC
    'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|' +
    'hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|' +
    'michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|' +
    'new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|' +
    'rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|' +
    'west virginia|wisconsin|wyoming|d\\.?c\\.?|' +
    // major US metros (covers most "City" postings without a state)
    'new york city|nyc|san francisco|sf bay|bay area|seattle|austin|boston|chicago|denver|atlanta|' +
    'los angeles|san diego|san jose|dallas|houston|miami|portland|phoenix|philadelphia|' +
    'minneapolis|nashville|charlotte|raleigh|salt lake city|pittsburgh|detroit|columbus' +
  ')\\b',
  'i',
)

// A clearly non-US place: a country, a well-known non-US hub, or a non-US region. Only consulted
// when no US hint is present.
const NON_US_RE = new RegExp(
  '\\b(' +
    // countries / nations
    'canada|mexico|brazil|argentina|chile|colombia|peru|united kingdom|england|scotland|wales|' +
    'ireland|france|germany|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|' +
    'norway|denmark|finland|poland|romania|czechia|czech republic|hungary|greece|turkey|israel|' +
    'united arab emirates|uae|saudi arabia|india|pakistan|bangladesh|china|hong kong|taiwan|japan|' +
    'south korea|korea|singapore|malaysia|thailand|vietnam|indonesia|philippines|australia|' +
    'new zealand|south africa|nigeria|kenya|egypt|' +
    // non-US hubs / cities
    'london|manchester|dublin|paris|berlin|munich|frankfurt|amsterdam|madrid|barcelona|lisbon|' +
    'milan|rome|zurich|geneva|vienna|stockholm|oslo|copenhagen|helsinki|warsaw|krakow|bucharest|' +
    'prague|budapest|athens|istanbul|tel aviv|dubai|bangalore|bengaluru|hyderabad|mumbai|' +
    'new delhi|gurgaon|gurugram|pune|chennai|noida|beijing|shanghai|shenzhen|taipei|tokyo|osaka|' +
    'seoul|kuala lumpur|bangkok|ho chi minh|hanoi|jakarta|manila|sydney|melbourne|brisbane|perth|' +
    'auckland|wellington|toronto|vancouver|montreal|ottawa|calgary|mexico city|guadalajara|' +
    'sao paulo|são paulo|rio de janeiro|buenos aires|bogota|cape town|johannesburg|nairobi|' +
    'lagos|cairo|' +
    // regions
    'emea|apac|latam|anz)\\b',
  'i',
)

/** True if a posting's free-text location is plausibly US-based (or unknown). */
export function isUsLocation(location: string | null | undefined): boolean {
  if (!location || !location.trim()) return true // unknown -> eligible
  if (US_HINT_RE.test(location)) return true // explicit US signal wins
  if (NON_US_RE.test(location)) return false // names a clearly non-US place, no US signal
  return true // "Remote", unrecognized city, etc. -> keep (bias toward inclusion)
}
