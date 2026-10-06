/**
 * Tag -> human label. A lookup only: it never filters, hides or drops anything.
 */
const STANDARD: Record<string, string> = {
  BIRT: 'Birth', CHR: 'Christening', DEAT: 'Death', BURI: 'Burial', CREM: 'Cremation',
  ADOP: 'Adoption', BAPM: 'Baptism', BARM: 'Bar mitzvah', BASM: 'Bas mitzvah', BLES: 'Blessing',
  CHRA: 'Adult christening', CONF: 'Confirmation', FCOM: 'First communion', ORDN: 'Ordination',
  NATU: 'Naturalization', EMIG: 'Emigration', IMMI: 'Immigration', CENS: 'Census', PROB: 'Probate',
  WILL: 'Will', GRAD: 'Graduation', RETI: 'Retirement', EVEN: 'Event', CAST: 'Caste',
  DSCR: 'Physical description', EDUC: 'Education', IDNO: 'Identification number', NATI: 'Nationality',
  NCHI: 'Number of children', NMR: 'Number of marriages', OCCU: 'Occupation', PROP: 'Property',
  RELI: 'Religion', RESI: 'Residence', SSN: 'Social Security number', TITL: 'Title', FACT: 'Fact',
  ANUL: 'Annulment', DIV: 'Divorce', DIVF: 'Divorce filed', ENGA: 'Engagement', MARB: 'Marriage banns',
  MARC: 'Marriage contract', MARL: 'Marriage license', MARS: 'Marriage settlement', MARR: 'Marriage',
  NOTE: 'Note', SOUR: 'Source citation', OBJE: 'Media link', FAMC: 'Family link (child)',
  FAMS: 'Family link (spouse)', ASSO: 'Association', ALIA: 'Alias', ANCI: 'Ancestor interest',
  DESI: 'Descendant interest', RFN: 'Record file number', AFN: 'Ancestral File number',
  REFN: 'Reference number', RIN: 'Record ID', CHAN: 'Change date', SUBM: 'Submitter link',
  ADDR: 'Address', PHON: 'Phone', EMAIL: 'Email', FAX: 'Fax', WWW: 'Website', RESN: 'Restriction',
  NAME: 'Name', SEX: 'Sex', HUSB: 'Spouse 1 link', WIFE: 'Spouse 2 link', CHIL: 'Child link',
  BAPL: 'LDS baptism', CONL: 'LDS confirmation', ENDL: 'LDS endowment', SLGC: 'LDS sealing to parents',
  SLGS: 'LDS sealing to spouse', SUBN: 'Submission link', LANG: 'Language',
};

const CUSTOM: Record<string, string> = {
  _UID: 'Unique ID', _MILT: 'Military service', _MILTID: 'Military ID', _MDCL: 'Medical',
  _PHOTO: 'Photo', _DNA: 'DNA', _FREL: 'Relationship to father', _MREL: 'Relationship to mother',
  _EMPL: 'Employment', _ELEC: 'Elected office', _EXCM: 'Excommunication', _FUN: 'Funeral',
  _HEIG: 'Height', _WEIG: 'Weight', _DEG: 'Degree', _NAMS: 'Namesake', _ORDI: 'Ordinance',
  _ORIG: 'Origin', _SEPR: 'Separation', _CIRC: 'Circumcision', _DEST: 'Destination',
  _MISN: 'Mission', _DCAUSE: 'Cause of death',
};

const STANDALONE: Record<string, string> = {
  HEAD: 'Header', TRLR: 'Trailer', SOUR: 'Source record', REPO: 'Repository record',
  OBJE: 'Media record', NOTE: 'Note record', SUBM: 'Submitter record', SUBN: 'Submission record',
};

/** Label for a fact tag (level-1 child of INDI/FAM). */
export function factLabel(tag: string): string {
  const std = STANDARD[tag];
  if (std) return std;
  const custom = CUSTOM[tag];
  if (custom) return `${custom} (custom ${tag})`;
  if (tag.startsWith('_')) return `Custom tag ${tag}`;
  return `Unknown tag ${tag}`;
}

/** Label for a standalone level-0 record (anything that is not INDI/FAM). */
export function recordLabel(tag: string): string {
  return STANDALONE[tag] ?? `${tag} record`;
}

/** Standard GEDCOM 5.5.1 tags (used only to count unknown tags for the report). */
const KNOWN_551 = new Set<string>([
  ...Object.keys(STANDARD), 'INDI', 'FAM', 'HEAD', 'TRLR', 'REPO', 'GEDC', 'VERS', 'FORM', 'CHAR', 'DEST',
  'DATE', 'TIME', 'PLAC', 'TYPE', 'CONT', 'CONC', 'GIVN', 'SURN', 'NSFX', 'NPFX', 'SPFX', 'NICK',
  'AGE', 'AGNC', 'CAUS', 'PAGE', 'DATA', 'TEXT', 'QUAY', 'EVEN', 'ROLE', 'FILE', 'MEDI', 'CALN',
  'AUTH', 'ABBR', 'PUBL', 'COPR', 'CORP', 'ADR1', 'ADR2', 'ADR3', 'CITY', 'STAE', 'POST', 'CTRY',
  'PEDI', 'STAT', 'RELA', 'MAP', 'LATI', 'LONG', 'FONE', 'ROMN', 'TEMP', 'FAMF', 'ORDI', 'BLOB',
  'TITL', 'PLAC', 'HUSB', 'WIFE', 'CHIL', 'SEX', 'NAME', 'RESN', 'LANG', 'SUBM', 'SUBN', 'OBJE',
]);

export function isUnknownTag(tag: string): boolean {
  return !tag.startsWith('_') && !KNOWN_551.has(tag);
}
