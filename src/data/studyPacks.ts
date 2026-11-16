import { StudyPack, StudyPackCategory } from '../types';

export const CUSTOM_PACKS_STORAGE_KEY = 'studydeck_custom_packs';
export const APPLIED_PACKS_STORAGE_KEY = 'studydeck_applied_packs';

interface StandardTopicInput {
  label: string;
  notesHtml: string;
  sectionName?: string;
  cards: Array<[string, string]>;
}

interface StandardSubjectInput {
  name: string;
  topics: StandardTopicInput[];
}

function buildStandardPack(input: {
  id: string;
  title: string;
  subtitle: string;
  category: StudyPackCategory;
  examBoard: string;
  tags: string[];
  highlights: string[];
  subjects: StandardSubjectInput[];
  todos?: Array<{ title: string; subjectName?: string; pri?: number; cat?: string }>;
}): StudyPack {
  const revSubjects: NonNullable<StudyPack['revision']['subjects']> = [];
  const sections: NonNullable<StudyPack['revision']['sections']> = [];
  const cards: NonNullable<StudyPack['revision']['cards']> = [];
  const plannerSubjects: NonNullable<StudyPack['planner']['subjects']> = [];

  let totalTopics = 0;

  input.subjects.forEach((subj, si) => {
    const sid = `${input.id}_s${si}`;
    const topicLabels: string[] = [];

    const revTopics = subj.topics.map((tp, ti) => {
      totalTopics++;
      const tid = `${input.id}_s${si}_t${ti}`;
      topicLabels.push(tp.label);

      if (tp.cards.length > 0) {
        const secId = `${tid}_sec`;
        const secName = tp.sectionName || tp.label;
        sections.push({
          id: secId,
          topicId: tid,
          topicLabel: tp.label,
          subjectName: subj.name,
          name: secName,
        });
        tp.cards.forEach(([q, a]) => {
          cards.push({
            sectionId: secId,
            sectionName: secName,
            topicId: tid,
            topicLabel: tp.label,
            subjectName: subj.name,
            q,
            a,
          });
        });
      }

      return {
        id: tid,
        label: tp.label,
        title: `${subj.name}: ${tp.label}`,
        sections: ['Specification Notes', 'Key Concepts'],
        notesHtml: tp.notesHtml,
      };
    });

    revSubjects.push({
      id: sid,
      name: subj.name,
      kind: 'doc',
      views: { notes: true, timeline: false, mindmap: true },
      topics: revTopics,
    });

    plannerSubjects.push({
      name: subj.name,
      weight: 2,
      topics: topicLabels,
    });
  });

  return {
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    category: input.category,
    examBoard: input.examBoard,
    tags: input.tags,
    highlights: input.highlights,
    author: 'StudyDeck Curated',
    ownerName: 'StudyDeck Official',
    isStandard: true,
    isCustom: false,
    visibility: 'public',
    createdAt: '2026-01-01T00:00:00.000Z',
    subjectCountPreview: input.subjects.length,
    topicCountPreview: totalTopics,
    cardCountPreview: cards.length,
    revision: {
      subjects: revSubjects,
      sections,
      cards,
    },
    planner: {
      subjects: plannerSubjects,
      todos: (input.todos || []).map((t) => ({
        title: t.title,
        subjectName: t.subjectName,
        pri: t.pri ?? 2,
        cat: t.cat || 'hw',
      })),
    },
  };
}

export const CURATED_STUDY_PACKS: StudyPack[] = [
  buildStandardPack({
    id: 'std_gcse_triple_science',
    title: 'GCSE Triple Science Complete Combo',
    subtitle:
      'Separate Biology, Chemistry & Physics specification subtopics, structured revision notes, and active-recall flashcards.',
    category: 'combo',
    examBoard: 'AQA / Edexcel GCSE',
    tags: ['GCSE Combo', 'Biology', 'Chemistry', 'Physics', 'Specification'],
    highlights: [
      '3 separate sciences · 12 specification subtopics',
      'Full structured study notes for every spec section',
      '36 core definition, equation & practical flashcards',
    ],
    subjects: [
      {
        name: 'Biology (Separate)',
        topics: [
          {
            label: '1. Cell Biology & Transport',
            notesHtml:
              '<h2>Eukaryotic vs Prokaryotic Cells</h2><ul><li><b>Animal &amp; plant cells (eukaryotic):</b> contain a nucleus, cytoplasm, cell membrane, mitochondria and ribosomes. Plants also have a cellulose cell wall, permanent vacuole and chloroplasts.</li><li><b>Bacterial cells (prokaryotic):</b> no true nucleus — single circular DNA loop plus plasmids.</li></ul><h2>Microscopy &amp; Transport</h2><ul><li><b>Magnification:</b> Image size ÷ Actual size.</li><li><b>Diffusion:</b> passive net movement of particles from high to low concentration.</li><li><b>Osmosis:</b> net movement of water across a partially permeable membrane from dilute to concentrated solution.</li><li><b>Active transport:</b> moves substances against a concentration gradient using energy from respiration.</li></ul>',
            cards: [
              ['What is the formula for magnification?', 'Magnification = Image size ÷ Actual size'],
              ['Define osmosis', 'Net movement of water molecules from a region of higher water potential to lower water potential across a partially permeable membrane'],
              ['How do prokaryotic cells store DNA?', 'As a single circular loop of DNA free in the cytoplasm (plus small rings called plasmids), with no nucleus'],
            ],
          },
          {
            label: '2. Organisation & Enzymes',
            notesHtml:
              '<h2>Digestive Enzymes</h2><ul><li><b>Amylase:</b> breaks starch into simple sugars (produced in salivary glands &amp; pancreas).</li><li><b>Protease:</b> breaks proteins into amino acids (stomach, pancreas, small intestine).</li><li><b>Lipase:</b> breaks lipids into fatty acids and glycerol.</li><li><b>Bile:</b> made in liver, stored in gall bladder; neutralises stomach acid and emulsifies fats to increase surface area.</li></ul><h2>Heart &amp; Blood Vessels</h2><ul><li><b>Arteries:</b> thick muscular/elastic walls carrying high-pressure blood away from the heart.</li><li><b>Veins:</b> thinner walls with valves preventing backflow at low pressure.</li><li><b>Capillaries:</b> one-cell-thick walls for fast diffusion exchange.</li></ul>',
            cards: [
              ['What are the two functions of bile?', 'Neutralises hydrochloric acid from the stomach (creating alkaline optimum pH) and emulsifies fats into tiny droplets to increase surface area for lipase'],
              ['Why does an enzyme denature at high temperatures?', 'Thermal energy breaks bonds holding the protein structure, permanently changing the shape of the active site so the substrate can no longer bind'],
              ['Which blood vessel brings oxygenated blood from the lungs to the left atrium?', 'The pulmonary vein'],
            ],
          },
          {
            label: '3. Bioenergetics & Infection',
            notesHtml:
              '<h2>Photosynthesis &amp; Respiration</h2><ul><li><b>Photosynthesis:</b> 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ (endothermic reaction in chloroplasts). Limiting factors: light intensity, CO₂ concentration, temperature.</li><li><b>Aerobic respiration:</b> C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O (releases maximum ATP in mitochondria).</li><li><b>Anaerobic respiration in muscles:</b> glucose → lactic acid (creates oxygen debt).</li></ul><h2>Immune Response</h2><ul><li>White blood cells defend via <b>phagocytosis</b> (engulfing), producing specific <b>antibodies</b>, and releasing <b>antitoxins</b>.</li><li>Vaccines introduce dead/weakened pathogens so memory lymphocytes respond faster on re-infection.</li></ul>',
            cards: [
              ['State the balanced symbol equation for photosynthesis', '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂'],
              ['What causes oxygen debt after vigorous exercise?', 'The build-up of lactic acid from anaerobic respiration, which requires extra oxygen to oxidise it in the liver'],
              ['How do vaccines provide long-term immunity?', 'They stimulate white blood cells to produce antibodies and memory cells, enabling faster and larger antibody production upon future exposure'],
            ],
          },
          {
            label: '4. Homeostasis & Genetics',
            notesHtml:
              '<h2>Nervous &amp; Hormonal Control</h2><ul><li><b>Reflex arc:</b> Stimulus → Receptor → Sensory neurone → Relay neurone (CNS) → Motor neurone → Effector → Response.</li><li><b>Blood glucose:</b> Insulin (from pancreas) lowers glucose by converting it to glycogen in liver/muscles; glucagon raises it back.</li><li><b>Kidney (Triple):</b> ADH increases collecting duct permeability so more water is reabsorbed.</li></ul><h2>Inheritance &amp; Evolution</h2><ul><li><b>Mitosis:</b> 2 genetically identical diploid daughter cells (growth/repair).</li><li><b>Meiosis:</b> 4 genetically varied haploid gametes.</li><li><b>Natural selection:</b> variation → survival advantage → reproduction → passing advantageous alleles.</li></ul>',
            cards: [
              ['How do impulses cross a synapse?', 'Chemicals (neurotransmitters) diffuse across the synaptic gap and bind to receptors on the next neurone to trigger a new electrical impulse'],
              ['Contrast mitosis and meiosis', 'Mitosis produces 2 identical diploid cells; meiosis produces 4 genetically different haploid gametes'],
              ['What is the role of ADH in water balance?', 'Increases the permeability of kidney collecting ducts so more water is reabsorbed into the blood when water levels are low'],
            ],
          },
        ],
      },
      {
        name: 'Chemistry (Separate)',
        topics: [
          {
            label: '1. Atomic Structure & Periodic Table',
            notesHtml:
              '<h2>Atomic Model &amp; Isotopes</h2><ul><li><b>Protons:</b> mass 1, charge +1 · <b>Neutrons:</b> mass 1, charge 0 · <b>Electrons:</b> negligible mass, charge −1.</li><li><b>Isotopes:</b> atoms of the same element with the same number of protons but different numbers of neutrons.</li></ul><h2>Periodic Trends</h2><ul><li><b>Group 1 (Alkali metals):</b> reactivity increases down the group because outer electron is further from nucleus and more shielded, so lost more easily.</li><li><b>Group 7 (Halogens):</b> reactivity decreases down the group because gaining an electron becomes harder as atomic radius &amp; shielding increase.</li></ul>',
            cards: [
              ['Why do Group 1 metals become more reactive down the group?', 'The outer shell is further from the nucleus with more inner-shell shielding, reducing electrostatic attraction so the outer electron is lost more easily'],
              ['Define an isotope', 'Atoms of the same element with the same number of protons (atomic number) but different numbers of neutrons (mass number)'],
              ['What happens to boiling point down Group 7 halogens?', 'It increases because molecules get larger with stronger intermolecular forces requiring more energy to overcome'],
            ],
          },
          {
            label: '2. Bonding & Structure',
            notesHtml:
              '<h2>Three Types of Strong Bonding</h2><ul><li><b>Ionic:</b> electrostatic attraction between oppositely charged ions (metal + non-metal). High melting points; conduct when molten or aqueous because ions are free to move.</li><li><b>Covalent:</b> shared pairs of electrons between non-metals. Simple molecules have low boiling points (weak intermolecular forces); giant covalent structures (diamond, graphite, SiO₂) have very high melting points.</li><li><b>Metallic:</b> giant lattice of positive metal ions surrounded by a sea of delocalised electrons (conducts heat and electricity, malleable).</li></ul>',
            cards: [
              ['Why can graphite conduct electricity whereas diamond cannot?', 'Each carbon in graphite forms 3 covalent bonds, leaving 1 delocalised electron per atom free to move; diamond forms 4 bonds with no free electrons'],
              ['Why do ionic compounds conduct electricity only when molten or dissolved?', 'In a solid lattice ions are fixed in position; when molten or aqueous the ions are free to move and carry charge'],
              ['Why do simple molecular substances have low melting points?', 'Only weak intermolecular forces between molecules need to be overcome, not strong covalent bonds'],
            ],
          },
          {
            label: '3. Quantitative & Electrolysis',
            notesHtml:
              '<h2>Moles &amp; Concentration</h2><ul><li><b>Moles:</b> n = mass (g) ÷ Mr</li><li><b>Concentration (mol/dm³):</b> moles ÷ volume (dm³) (1 dm³ = 1000 cm³).</li><li><b>Gas volume (Triple):</b> 1 mole of any gas occupies 24 dm³ at RTP.</li></ul><h2>Electrolysis Rules</h2><ul><li><b>Cathode (−):</b> metal forms if less reactive than hydrogen; otherwise hydrogen gas is produced.</li><li><b>Anode (+):</b> halide gas forms if a halide is present; otherwise oxygen gas is produced from OH⁻ ions.</li></ul>',
            cards: [
              ['State the formula linking moles, mass, and Mr', 'Moles = Mass (g) ÷ Relative formula mass (Mr)'],
              ['At the cathode during aqueous electrolysis, when is hydrogen produced instead of the metal?', 'Whenever the metal is more reactive than hydrogen (e.g. sodium, potassium, magnesium)'],
              ['What volume does 1 mole of any gas occupy at room temperature and pressure?', '24 dm³'],
            ],
          },
          {
            label: '4. Rates, Equilibrium & Organic',
            notesHtml:
              '<h2>Rates &amp; Reversible Reactions</h2><ul><li>Increasing temperature, concentration, surface area, or adding a catalyst increases the frequency of successful collisions.</li><li><b>Le Chatelier’s Principle:</b> if a system at equilibrium is disturbed, the position of equilibrium shifts to oppose the change.</li></ul><h2>Organic Chemistry (Triple)</h2><ul><li><b>Alkanes (CₙH₂ₙ₊₂):</b> saturated hydrocarbons (single bonds only).</li><li><b>Alkenes (CₙH₂ₙ):</b> unsaturated (C=C double bond); decolourise bromine water from orange to colourless.</li></ul>',
            cards: [
              ['How does a catalyst increase rate of reaction?', 'It provides an alternative reaction pathway with a lower activation energy'],
              ['How do you test for an alkene (C=C bond)?', 'Shake with orange bromine water; an alkene turns it colourless'],
              ['In a reversible reaction where forward is exothermic, what happens if you increase temperature?', 'Equilibrium shifts to the endothermic (reverse) direction to absorb heat, reducing product yield'],
            ],
          },
        ],
      },
      {
        name: 'Physics (Separate)',
        topics: [
          {
            label: '1. Energy & Electricity',
            notesHtml:
              '<h2>Key Energy Equations</h2><ul><li><b>Kinetic Energy:</b> Eₖ = ½ m v²</li><li><b>GPE:</b> Eₚ = m g h</li><li><b>Efficiency:</b> useful output ÷ total input (× 100%)</li><li><b>Specific Heat Capacity:</b> ΔE = m c Δθ</li></ul><h2>Circuits &amp; Power</h2><ul><li><b>Charge:</b> Q = I t · <b>Potential difference:</b> V = I R · <b>Power:</b> P = V I = I² R</li><li>In <b>series</b>: current is same everywhere, PD splits. In <b>parallel</b>: PD is same across branches, current splits.</li></ul>',
            cards: [
              ['State the equation for kinetic energy', 'Ek = 0.5 × m × v²'],
              ['State the relationship between potential difference, current and resistance', 'V = I × R'],
              ['Why does filament lamp resistance increase as potential difference rises?', 'Higher current heats the filament, increasing ion lattice vibrations so electrons collide more frequently'],
            ],
          },
          {
            label: '2. Particle Model & Radiation',
            notesHtml:
              '<h2>States &amp; Latent Heat</h2><ul><li><b>Density:</b> ρ = m ÷ V</li><li><b>Specific latent heat:</b> E = m L (energy needed to change state without changing temperature).</li></ul><h2>Nuclear Decay</h2><ul><li><b>Alpha (α):</b> helium nucleus (²He⁴), strongly ionising, stopped by paper.</li><li><b>Beta (β):</b> fast electron from neutron → proton + e⁻, stopped by thin aluminium.</li><li><b>Gamma (γ):</b> EM wave, weakly ionising, reduced by thick lead/concrete.</li><li><b>Half-life:</b> average time for half the unstable nuclei (or activity) to decay.</li></ul>',
            cards: [
              ['What is specific latent heat of fusion?', 'The energy required to change 1 kg of a substance from solid to liquid without changing its temperature'],
              ['Compare ionising power and penetration of alpha vs gamma radiation', 'Alpha is strongly ionising and least penetrating (stopped by paper); gamma is weakly ionising and most penetrating (thick lead)'],
              ['Define half-life', 'The time taken for the number of radioactive nuclei (or count rate) in a sample to halve'],
            ],
          },
          {
            label: '3. Forces & Motion',
            notesHtml:
              '<h2>Newton’s Laws &amp; Momentum</h2><ul><li><b>F = m a</b> (resultant force = mass × acceleration).</li><li><b>Momentum:</b> p = m v (conserved in closed systems).</li><li><b>Work done:</b> W = F s · <b>Weight:</b> W = m g.</li></ul><h2>Motion Graphs</h2><ul><li>Distance-time gradient = speed.</li><li>Velocity-time gradient = acceleration; area under velocity-time graph = distance travelled.</li></ul>',
            cards: [
              ['What does the area under a velocity-time graph represent?', 'Total distance travelled'],
              ['State Newton’s Third Law', 'Whenever two objects interact, the forces they exert on each other are equal in size and opposite in direction'],
              ['State the equation linking force, mass, and acceleration', 'F = m × a'],
            ],
          },
          {
            label: '4. Waves & Magnetism',
            notesHtml:
              '<h2>Wave Properties</h2><ul><li><b>Wave speed:</b> v = f λ · <b>Period:</b> T = 1 ÷ f</li><li><b>Transverse waves</b> (light, water): oscillations perpendicular to energy transfer. <b>Longitudinal</b> (sound): parallel compressions &amp; rarefactions.</li><li><b>EM Spectrum (longest λ → shortest λ):</b> Radio, Micro, Infrared, Visible, UV, X-rays, Gamma.</li></ul><h2>Electromagnetism (Triple)</h2><ul><li><b>Motor effect:</b> F = B I L (Fleming’s Left-Hand Rule).</li><li><b>Transformer equation:</b> Vₚ / Vₛ = Nₚ / Nₛ.</li></ul>',
            cards: [
              ['State the wave equation linking speed, frequency and wavelength', 'v = f × λ'],
              ['List the electromagnetic spectrum from longest to shortest wavelength', 'Radio, Microwave, Infrared, Visible, Ultraviolet, X-ray, Gamma ray'],
              ['What does Fleming’s Left-Hand Rule determine?', 'The direction of force (Thumb) from Magnetic Field (First finger) and Current (Second finger)'],
            ],
          },
        ],
      },
    ],
    todos: [
      { title: 'Complete 1 Biology enzymes & osmosis past-paper question set', subjectName: 'Biology', pri: 2 },
      { title: 'Memorise all Physics Paper 1 equations before practice test', subjectName: 'Physics', pri: 3 },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_maths_english_core',
    title: 'GCSE Maths Higher & English Literature Combo',
    subtitle:
      'Essential core pair: Higher Maths theorems & formulas alongside Macbeth, Inspector Calls & A Christmas Carol.',
    category: 'combo',
    examBoard: 'Edexcel / AQA GCSE',
    tags: ['GCSE Core', 'Maths Higher', 'English Literature', 'Formulas & Quotes'],
    highlights: [
      '2 core compulsory subjects · 8 detailed specification topics',
      'Formula sheets & annotated literature quote banks',
      '24 high-yield active-recall flashcards',
    ],
    subjects: [
      {
        name: 'Maths Higher',
        topics: [
          {
            label: 'Number, Surds & Indices',
            notesHtml:
              '<h2>Index Laws &amp; Surds</h2><ul><li><b>aᵐ × aⁿ = aᵐ⁺ⁿ</b> · <b>(aᵐ)ⁿ = aᵐⁿ</b> · <b>a⁻ⁿ = 1/aⁿ</b> · <b>a^(1/n) = ⁿ√a</b></li><li><b>Surd simplification:</b> √(ab) = √a × √b. Rationalise denominators by multiplying top and bottom by √b (or conjugate a ∓ √b).</li><li><b>Compound growth:</b> Final = Initial × (1 ± r/100)ⁿ</li></ul>',
            cards: [
              ['How do you simplify a^(−1/2)?', '1 ÷ √a'],
              ['What is the multiplier for a 15% compound decrease?', '0.85'],
              ['How do you rationalise 1 / (2 + √3)?', 'Multiply numerator and denominator by the conjugate (2 − √3)'],
            ],
          },
          {
            label: 'Algebra & Quadratics',
            notesHtml:
              '<h2>Quadratic Formula &amp; Lines</h2><ul><li><b>Quadratic formula:</b> x = [−b ± √(b² − 4ac)] ÷ (2a)</li><li><b>Difference of two squares:</b> a² − b² = (a + b)(a − b)</li><li><b>Perpendicular gradients:</b> m₁ × m₂ = −1</li><li><b>Turning point:</b> complete the square (x + p)² + q → minimum at (−p, q).</li></ul>',
            cards: [
              ['State the quadratic formula', 'x = (−b ± √(b² − 4ac)) / 2a'],
              ['If line L1 has gradient 2/3, what is the gradient of a perpendicular line?', '−3/2 (negative reciprocal)'],
              ['What is the turning point of y = (x − 4)² + 7?', '(4, 7)'],
            ],
          },
          {
            label: 'Geometry & Trigonometry',
            notesHtml:
              '<h2>Circle Theorems &amp; Non-Right Triangles</h2><ul><li>Angle at the centre is <b>twice</b> the angle at the circumference.</li><li>Angle in a semicircle is <b>90°</b>. Opposite angles of a cyclic quadrilateral sum to <b>180°</b>.</li><li><b>Sine Rule:</b> a / sin A = b / sin B · <b>Cosine Rule:</b> a² = b² + c² − 2bc cos A</li><li><b>Area of triangle:</b> ½ a b sin C</li></ul>',
            cards: [
              ['State the exact value of sin 30°, cos 60° and tan 45°', 'sin 30° = 1/2, cos 60° = 1/2, tan 45° = 1'],
              ['State the Cosine Rule for finding a missing side a', 'a² = b² + c² − 2bc cos A'],
              ['What do opposite angles in a cyclic quadrilateral add up to?', '180°'],
            ],
          },
          {
            label: 'Probability & Statistics',
            notesHtml:
              '<h2>Histograms &amp; Cumulative Frequency</h2><ul><li><b>Frequency density</b> = Frequency ÷ Class width (area of bar = frequency).</li><li><b>Conditional probability:</b> P(A and B) = P(A) × P(B | A) — update denominators when without replacement.</li><li><b>Interquartile range (IQR):</b> Q₃ − Q₁ (measures spread without outliers).</li></ul>',
            cards: [
              ['State the formula for frequency density on a histogram', 'Frequency ÷ Class width'],
              ['What does the area of a bar in a histogram represent?', 'The frequency of that class interval'],
              ['How is interquartile range calculated?', 'Upper quartile (Q3) minus Lower quartile (Q1)'],
            ],
          },
        ],
      },
      {
        name: 'English Literature',
        topics: [
          {
            label: 'Macbeth: Ambition & Guilt',
            notesHtml:
              '<h2>Key Themes &amp; Context</h2><ul><li><b>Jacobean context:</b> James I believed in the Divine Right of Kings and feared witchcraft (Daemonologie). Regicide disrupts the Great Chain of Being.</li><li><b>Ambition:</b> "Stars, hide your fires; Let not light see my black and deep desires" (1.4).</li><li><b>Guilt:</b> "Will all great Neptune’s ocean wash this blood clean from my hand?" (2.2) vs Lady Macbeth’s "Out, damned spot!" (5.1).</li></ul>',
            cards: [
              ['Complete the quote: "Will all great Neptune’s ocean wash this..."', '"...blood clean from my hand?" (Macbeth, Act 2 Scene 2 — symbolising inescapable guilt)'],
              ['Why does Shakespeare open Macbeth with the Three Witches?', 'To establish a dark, supernatural mood and appeal to King James I’s fascination with witchcraft and the disruption of order'],
              ['What does "Vaulting ambition, which o’erleaps itself" reveal?', 'Macbeth recognises that unchecked ambition is his hamartia (fatal flaw) that will lead to his downfall'],
            ],
          },
          {
            label: 'An Inspector Calls',
            notesHtml:
              '<h2>Social Responsibility & Socialism</h2><ul><li>Set in <b>1912</b> (pre-WWI, rigid class hierarchy), written in <b>1945</b> (post-WWII push for welfare state). Priestley uses dramatic irony via Birling’s Titanic/war predictions.</li><li><b>Inspector Goole’s warning:</b> "We are members of one body. We are responsible for each other."</li><li><b>Generational divide:</b> Sheila &amp; Eric accept guilt; Arthur &amp; Sybil Birling refuse change.</li></ul>',
            cards: [
              ['Why did Priestley set An Inspector Calls in 1912 but write it in 1945?', 'To use dramatic irony to discredit capitalist complacency (Birling’s false predictions) and urge post-1945 audiences toward social responsibility'],
              ['Quote Inspector Goole’s final warning about collective responsibility', '"We are members of one body. We are responsible for each other." (warning of "fire and blood and anguish")'],
              ['How does Sheila Birling change across the play?', 'She transforms from naive and materialistic to morally aware, confronting her parents and acting as Priestley’s voice for generational change'],
            ],
          },
          {
            label: 'A Christmas Carol',
            notesHtml:
              '<h2>Redemption & Victorian Poverty</h2><ul><li>Dickens critiques Thomas Malthus’s views on the "surplus population" and the 1834 Poor Law through Scrooge’s cruelty in Stave 1.</li><li><b>Ignorance and Want:</b> allegories hidden under the Ghost of Christmas Present’s robe — "Beware them both... most of all beware this boy".</li><li><b>Transformation:</b> Scrooge becomes "as good a friend, as good a master, and as good a man, as the good old city knew".</li></ul>',
            cards: [
              ['What do the two children "Ignorance and Want" symbolise in Stave 3?', 'Mankind’s neglect of education and basic welfare for the Victorian poor, warning that ignoring poverty leads to society’s doom'],
              ['Quote Marley’s Ghost explaining his chains in Stave 1', '"I wear the chain I forged in life" (symbolising moral consequences of greed)'],
              ['What transformation occurs in Scrooge’s final stave?', 'He embraces generosity and community, becoming a second father to Tiny Tim and keeping Christmas in his heart'],
            ],
          },
          {
            label: 'Unseen & Anthology Poetry',
            notesHtml:
              '<h2>Analytical Toolkit (MILES)</h2><ul><li><b>Meaning &amp; Tone:</b> identify speaker’s attitude and shifts (volta).</li><li><b>Imagery &amp; Language:</b> metaphor, simile, personification, semantic fields.</li><li><b>Structure &amp; Form:</b> enjambment, caesura, rhyme scheme, sonnet/dramatic monologue, stanza regularity.</li></ul>',
            cards: [
              ['What is a "volta" in poetry?', 'A turning point in thought, tone, or argument within a poem'],
              ['What effect does enjambment often create?', 'Fluidity, overflowing emotion, urgency, or a lack of control'],
              ['What does caesura achieve in a line of poetry?', 'A deliberate pause mid-line that creates tension, hesitation, or emphasis'],
            ],
          },
        ],
      },
    ],
    todos: [
      { title: 'Do 5 non-calculator circle theorem & trigonometry questions', subjectName: 'Maths Higher', pri: 2 },
      { title: 'Write 2 PEEL paragraphs comparing guilt in Macbeth', subjectName: 'English Literature', pri: 2 },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_humanities_combo',
    title: 'GCSE Humanities Combo (History & Geography)',
    subtitle:
      'GCSE History (Weimar/Nazi Germany, Cold War & Medicine) paired with Geography (Hazards, Rivers/Coasts & Urban Issues).',
    category: 'combo',
    examBoard: 'Edexcel / AQA GCSE',
    tags: ['GCSE Combo', 'History', 'Geography', 'Case Studies'],
    highlights: [
      '2 humanities subjects · 6 full specification modules',
      'Verified case-study statistics & chronology notes',
      '20 flashcards covering key dates, policies & places',
    ],
    subjects: [
      {
        name: 'History (GCSE)',
        topics: [
          {
            label: 'Weimar & Nazi Germany (1918–39)',
            notesHtml:
              '<h2>Weimar Crisis &amp; Recovery</h2><ul><li><b>1919 Treaty of Versailles:</b> £6.6bn reparations, army 100k, War Guilt Clause 231, loss of Alsace-Lorraine &amp; Saar.</li><li><b>1923 Hyperinflation:</b> Ruhr invasion → passive resistance → printing money. Solved by Stresemann’s Rentenmark &amp; 1924 Dawes Plan.</li></ul><h2>Nazi Consolidation (1933–34)</h2><ul><li><b>Jan 1933:</b> Hitler Chancellor → <b>Feb:</b> Reichstag Fire → <b>Mar:</b> Enabling Act → <b>Jun 1934:</b> Night of the Long Knives → <b>Aug 1934:</b> Führer.</li></ul>',
            cards: [
              ['Name the 3 key events between Feb 1933 and June 1934 that cemented Hitler’s dictatorship', 'Reichstag Fire (Feb 1933), Enabling Act (Mar 1933), and Night of the Long Knives (Jun 1934)'],
              ['How did Gustav Stresemann solve hyperinflation in 1923–24?', 'Replaced the worthless mark with the Rentenmark and negotiated US loans under the Dawes Plan (1924)'],
              ['What was Article 48 of the Weimar Constitution?', 'Emergency power allowing the President to rule by decree without Reichstag approval'],
            ],
          },
          {
            label: 'Cold War & Superpower Relations',
            notesHtml:
              '<h2>Origins &amp; Flashpoints (1945–62)</h2><ul><li><b>Conferences (1945):</b> Yalta (Feb) agreed UN &amp; free elections; Potsdam (Jul) showed tension over Eastern Europe &amp; the atomic bomb.</li><li><b>Berlin Blockade (1948–49):</b> Stalin cut access → Western Berlin Airlift supplied 2.3m tons. Led to NATO (1949) &amp; Warsaw Pact (1955).</li><li><b>Cuban Missile Crisis (1962):</b> 13 days; ended with USSR removing missiles in return for US promise not to invade Cuba (and secret Turkey missile removal).</li></ul>',
            cards: [
              ['What did the Truman Doctrine (1947) state?', 'The USA would provide economic and military aid to countries threatened by communism (policy of containment)'],
              ['Why did the USSR build the Berlin Wall in August 1961?', 'To stop the mass emigration ("brain drain") of skilled East Germans fleeing into West Berlin'],
              ['How was the Cuban Missile Crisis (1962) resolved?', 'Khrushchev removed missiles from Cuba; Kennedy pledged not to invade Cuba and secretly agreed to remove US Jupiter missiles from Turkey'],
            ],
          },
          {
            label: 'Medicine Through Time',
            notesHtml:
              '<h2>Change &amp; Continuity Highlights</h2><ul><li><b>Medieval (c1250–1500):</b> Four Humours &amp; Miasma dominated; Church controlled training.</li><li><b>1854–61 Breakthroughs:</b> John Snow proved cholera spread via water (Broad Street pump); Louis Pasteur published Germ Theory (1861); Lister introduced carbolic acid antiseptics (1867).</li><li><b>Modern:</b> Fleming discovered penicillin (1928), Florey &amp; Chain mass-produced it; NHS founded in 1948.</li></ul>',
            cards: [
              ['Who proved cholera was waterborne in 1854 by mapping Broad Street?', 'John Snow'],
              ['What did Louis Pasteur prove with his 1861 Germ Theory?', 'That microorganisms in the air cause decay and infectious disease (disproving spontaneous generation)'],
              ['Who turned Alexander Fleming’s 1928 discovery of penicillin into a mass-produced drug?', 'Howard Florey and Ernst Chain'],
            ],
          },
        ],
      },
      {
        name: 'Geography (GCSE)',
        topics: [
          {
            label: 'Tectonic & Weather Hazards',
            notesHtml:
              '<h2>Plate Boundaries &amp; Earthquakes</h2><ul><li><b>Destructive:</b> oceanic subducts under continental (earthquakes + explosive volcanoes).</li><li><b>Nepal 2015 (LIC, M7.8):</b> ~9,000 deaths, $5bn damage, Mount Everest avalanches. <b>New Zealand/Chile (HIC):</b> strict building codes reduced casualties despite high magnitude.</li></ul><h2>Tropical Storms</h2><ul><li>Form over oceans ≥ 27°C between 5°–30° latitude; Coriolis effect causes spin. Example: <b>Typhoon Haiyan (2013)</b>, Tacloban storm surge.</li></ul>',
            cards: [
              ['Why do tropical storms only form over oceans warmer than 27°C?', 'Warm ocean water provides intense evaporation and latent heat energy needed to drive rapid rising moist air'],
              ['Why does subduction occur at destructive plate margins?', 'Denser oceanic crust sinks beneath less dense continental crust into the mantle'],
              ['Give 2 ways HICs reduce earthquake fatalities compared to LICs', 'Enforcing earthquake-resistant building codes (shock absorbers/cross-bracing) and running rapid emergency drills and early warning systems'],
            ],
          },
          {
            label: 'Rivers & Coastal Landscapes',
            notesHtml:
              '<h2>Fluvial &amp; Coastal Processes</h2><ul><li><b>4 erosion types:</b> Hydraulic action, Abrasion, Attrition, Solution.</li><li><b>Upper → Lower course:</b> V-shaped valleys &amp; waterfalls (interlocking spurs) → meanders &amp; oxbow lakes → floodplains &amp; levees.</li><li><b>Coastal management:</b> Hard engineering (sea walls, groynes) vs Soft engineering (beach nourishment, dune regeneration, managed retreat).</li></ul>',
            cards: [
              ['Distinguish between abrasion and attrition in a river', 'Abrasion is sediment scraping/wearing away the bed and banks; attrition is rocks colliding with each other and becoming smaller and rounder'],
              ['How does an oxbow lake form?', 'Lateral erosion narrows a meander neck until a flood cuts straight through; deposition seals off the old loop'],
              ['Name one disadvantage of coastal groynes', 'They trap sediment by halting longshore drift, starving beaches further down the coast and increasing erosion there'],
            ],
          },
          {
            label: 'Urban Issues & Development',
            notesHtml:
              '<h2>Urbanisation &amp; Megacities</h2><ul><li>Driven by <b>natural increase</b> and <b>rural-to-urban migration</b> (push/pull factors).</li><li><b>NEE Case Study (Rio / Lagos):</b> economic opportunities in formal/informal sectors vs favela/slum sanitation, congestion, and Favela Bairro self-help upgrades.</li><li><b>UK City (London / Bristol):</b> urban greening, integrated transport, brownfield regeneration.</li></ul>',
            cards: [
              ['What are the two main causes of rapid megacity growth?', 'Rural-to-urban migration (push-pull factors) and high natural increase among young adult populations'],
              ['Give one advantage of regenerating brownfield sites over building on greenfield land', 'Reuses derelict land, preserves countryside/habitats, and often connects to existing transport infrastructure'],
            ],
          },
        ],
      },
    ],
    todos: [
      { title: 'Create a Weimar 1919–1934 timeline from memory & check errors', subjectName: 'History', pri: 2 },
      { title: 'Review Nepal vs New Zealand earthquake case-study stats', subjectName: 'Geography', pri: 1 },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_cs_french_combo',
    title: 'GCSE Computer Science & French Combo',
    subtitle:
      'Systems Architecture, Binary, Networks & Algorithms paired with French GCSE themes, tenses & high-frequency vocab.',
    category: 'combo',
    examBoard: 'OCR / AQA GCSE',
    tags: ['GCSE Combo', 'Computer Science', 'French', 'Coding & Vocab'],
    highlights: [
      '2 option subjects · 6 specification modules',
      'CPU FDE cycle, binary/hex & French 3-tense verb tables',
      '20 active-recall flashcards ready for Live Quiz',
    ],
    subjects: [
      {
        name: 'Computer Science',
        topics: [
          {
            label: 'Systems Architecture & CPU',
            notesHtml:
              '<h2>Von Neumann &amp; Fetch-Decode-Execute</h2><ul><li><b>Registers:</b> PC (next instruction address), MAR (memory address), MDR (fetched data/instruction), ACC (ALU results).</li><li><b>CU (Control Unit):</b> coordinates timing &amp; decodes instructions. <b>ALU:</b> arithmetic &amp; logic operations.</li><li><b>Performance factors:</b> clock speed, cache size (fast SRAM near CPU), number of cores.</li></ul>',
            cards: [
              ['What does the Program Counter (PC) hold?', 'The memory address of the next instruction to be fetched'],
              ['State the roles of the MAR and MDR', 'MAR holds the memory address currently being read/written; MDR holds the actual data or instruction transferred to/from memory'],
              ['Name the three main factors affecting CPU performance', 'Clock speed, number of cores, and cache size'],
            ],
          },
          {
            label: 'Data Representation & Networks',
            notesHtml:
              '<h2>Binary, Hex &amp; Sound/Images</h2><ul><li><b>1 byte = 8 bits; 1 nibble = 4 bits.</b></li><li><b>Image size (bits)</b> = width × height × colour depth. <b>Sound size</b> = sample rate × duration × bit depth.</li></ul><h2>Network Security &amp; Topologies</h2><ul><li><b>Star topology:</b> central switch; easy to add devices, no data collisions, single point of failure at switch.</li><li><b>Protocols:</b> HTTP/HTTPS, FTP, POP/IMAP/SMTP, TCP/IP.</li></ul>',
            cards: [
              ['How do you calculate the file size of a bitmap image in bits?', 'Width (px) × Height (px) × Colour depth (bits per pixel)'],
              ['Convert binary 10101100 to hexadecimal', 'AC (1010 = 10 = A, 1100 = 12 = C)'],
              ['Explain the difference between IMAP and POP for email', 'POP downloads and removes emails from the server onto one device; IMAP keeps emails synced on the server across multiple devices'],
            ],
          },
          {
            label: 'Algorithms & Programming',
            notesHtml:
              '<h2>Searching &amp; Sorting</h2><ul><li><b>Binary search:</b> requires a <b>sorted</b> list; halves search space each step (much faster on large lists than linear search).</li><li><b>Bubble sort</b> swaps adjacent out-of-order pairs per pass; <b>Merge sort</b> splits list down to size 1 then merges in sorted order.</li><li><b>Defensive design:</b> input validation, authentication, maintainability (comments, indentation, constants).</li></ul>',
            cards: [
              ['What precondition is required before running a binary search?', 'The dataset must already be sorted in order'],
              ['How does Merge Sort work?', 'Divide-and-conquer: repeatedly splits the list in half until sublists of length 1, then merges pairs back in sorted order'],
              ['Distinguish between syntax errors and logic errors', 'Syntax errors break language grammar rules so code won’t compile/run; logic errors run without crashing but produce incorrect output'],
            ],
          },
        ],
      },
      {
        name: 'French (GCSE)',
        topics: [
          {
            label: 'Theme 1: Identity & Culture',
            notesHtml:
              '<h2>Relationships &amp; Technology Opinions</h2><ul><li><b>Useful structures:</b> <i>Je m’entends bien avec…</i> (I get on well with), <i>Ce qui me plaît, c’est…</i> (What pleases me is…), <i>À mon avis…</i></li><li><b>Advantages of tech:</b> <i>On peut rester en contact facilement</i> vs <i>Il y a des risques de cyberharcèlement</i>.</li></ul>',
            cards: [
              ['How do you say "I get on well with my family" in French?', 'Je m’entends bien avec ma famille'],
              ['Translate: "In my opinion, social media is useful but dangerous"', 'À mon avis, les réseaux sociaux sont utiles mais dangereux'],
              ['What does "Je suis passionné(e) par…" mean?', 'I am passionate about…'],
            ],
          },
          {
            label: 'Theme 2: Local Area & Environment',
            notesHtml:
              '<h2>Town, Travel &amp; Global Issues</h2><ul><li><b>Environment:</b> <i>Pour protéger l’environnement, il faut recycler / utiliser les transports en commun</i>.</li><li><b>Problems:</b> <i>le réchauffement climatique</i> (global warming), <i>la pollution de l’air</i>, <i>le gaspillage</i> (waste).</li></ul>',
            cards: [
              ['How do you say "We must protect the environment" in French?', 'Il faut protéger l’environnement (or Nous devons protéger l’environnement)'],
              ['Translate "le réchauffement climatique"', 'Global warming / climate change'],
              ['How do you say "Last year I went to Spain by train"?', 'L’année dernière, je suis allé(e) en Espagne en train'],
            ],
          },
          {
            label: 'Grammar & Three Core Tenses',
            notesHtml:
              '<h2>Key GCSE Tense Patterns</h2><ul><li><b>Present:</b> <i>je fais / j’ai / je vais / je joue</i></li><li><b>Perfect (Past):</b> avoir/être + past participle (remember DR MRS VANDERTRAMP takes <i>être</i>: <i>je suis allé(e)</i>).</li><li><b>Near Future &amp; Simple Future:</b> <i>je vais faire</i> (going to do) / <i>je ferai</i> (I will do).</li><li><b>Grade 8–9 Boosters:</b> <i>Si j’avais le choix, je voudrais…</i> / <i>Après avoir fini…</i></li></ul>',
            cards: [
              ['How do you form the near future tense in French?', 'Present tense of aller (e.g. je vais) + infinitive verb'],
              ['Which auxiliary verb do reflexive verbs and movement verbs like aller/venir take in the perfect tense?', 'Être (with past participle agreeing in gender/number)'],
              ['Translate: "If I had the choice, I would live in France"', 'Si j’avais le choix, j’habiterais en France'],
            ],
          },
        ],
      },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_combined_science',
    title: 'GCSE Combined Science (Trilogy Paper 1)',
    subtitle:
      'Focused Combined Science Trilogy pack covering Biology, Chemistry & Physics Paper 1 essentials & required practicals.',
    category: 'combo',
    examBoard: 'AQA Trilogy (8464)',
    tags: ['Combined Science', 'GCSE', 'Required Practicals'],
    highlights: [
      'Biology, Chemistry & Physics Paper 1 core spec',
      'Key required practicals summary notes',
      '15 high-yield Trilogy exam flashcards',
    ],
    subjects: [
      {
        name: 'Biology (Combined P1)',
        topics: [
          {
            label: 'Cells, Microscopy & Osmosis Practical',
            notesHtml:
              '<h2>Potato Osmosis Required Practical</h2><ul><li>Cut equal potato cylinders, blot dry, measure starting mass.</li><li>Place in different sucrose concentrations for fixed time, blot dry, reweigh.</li><li>Calculate <b>% change in mass</b> = (change ÷ start mass) × 100. Where graph crosses x-axis = internal concentration of potato cells.</li></ul>',
            cards: [
              ['In the potato osmosis practical, why must cylinders be blotted dry before weighing?', 'To remove excess surface water so only mass change inside the cells is measured'],
              ['How do you calculate percentage change in mass?', '(Final mass − Initial mass) ÷ Initial mass × 100'],
              ['Which stain is used to view onion cells under a light microscope?', 'Iodine solution (turns starch blue-black and highlights nuclei)'],
            ],
          },
          {
            label: 'Disease, Respiration & Photosynthesis',
            notesHtml:
              '<h2>Communicable Diseases &amp; Plant Bioenergetics</h2><ul><li><b>Pathogens:</b> Viruses (measles, HIV, TMV), Bacteria (Salmonella, gonorrhoea), Fungi (rose black spot), Protists (malaria vector: mosquito).</li><li><b>Food tests:</b> Benedict’s (sugars → brick red), Iodine (starch → blue-black), Biuret (protein → purple), Ethanol/Sudan III (lipids).</li></ul>',
            cards: [
              ['What reagent tests for protein and what is a positive colour change?', 'Biuret solution; changes from blue to purple/lilac'],
              ['What causes malaria and how is it spread?', 'A protist pathogen, spread by female Anopheles mosquitoes acting as vectors'],
              ['How do you test for reducing sugars like glucose?', 'Heat with Benedict’s solution; turns from blue to green/orange/brick-red precipitate'],
            ],
          },
        ],
      },
      {
        name: 'Chemistry (Combined P1)',
        topics: [
          {
            label: 'Atoms, Bonding & Acids Practical',
            notesHtml:
              '<h2>Making Soluble Salts Required Practical</h2><ul><li>Warm dilute acid (e.g. H₂SO₄) gently, add insoluble base (e.g. CuO) in <b>excess</b> until no more dissolves so all acid reacts.</li><li><b>Filter</b> off excess unreacted oxide; heat filtrate gently to evaporate half the water, then leave to <b>crystallise</b>.</li></ul>',
            cards: [
              ['Why is copper oxide added in excess when making copper sulfate crystals?', 'To ensure all the sulfuric acid has completely reacted so the salt solution is pure'],
              ['What are the products of acid + metal carbonate?', 'Salt + Water + Carbon dioxide'],
              ['Explain why exothermic reactions cause temperature of surroundings to rise', 'More energy is released forming new bonds in products than is absorbed breaking bonds in reactants'],
            ],
          },
        ],
      },
      {
        name: 'Physics (Combined P1)',
        topics: [
          {
            label: 'Energy, Density & Circuits Practicals',
            notesHtml:
              '<h2>Specific Heat Capacity &amp; Wire Resistance</h2><ul><li><b>Wire resistance practical:</b> as wire length increases, resistance is <b>directly proportional</b> (assuming constant temperature &amp; cross-section).</li><li><b>National Grid:</b> Step-up transformers increase PD (lowers current → reduces I²R heating loss in cables); step-down transformers lower PD to 230V for homes.</li></ul>',
            cards: [
              ['Why does the National Grid transmit electricity at very high voltage?', 'High voltage lowers current for the same power (P=VI), dramatically reducing thermal energy loss (P=I²R) in cables'],
              ['State the UK mains electricity frequency and potential difference', '50 Hz and 230 V alternating current (AC)'],
              ['How do you find the density of an irregular solid object?', 'Measure mass on a balance; measure volume by water displacement in a Eureka can/measuring cylinder; then ρ = m ÷ V'],
            ],
          },
        ],
      },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_maths_formulas_fc',
    title: 'GCSE Maths Must-Know Formulas & Theorems',
    subtitle:
      'Pure active-recall deck + quick reference sheet for Higher GCSE equations not given on standard formula sheets.',
    category: 'flashcards',
    examBoard: 'Edexcel / AQA Higher',
    tags: ['Flashcards', 'Maths', 'Formulas', 'Quick Recall'],
    highlights: [
      '1 subject · 2 formula spec sections',
      'Concise equation & exact-trig cheat sheet notes',
      '14 essential flashcards ideal for Live Quiz',
    ],
    subjects: [
      {
        name: 'Maths Formulas Deck',
        topics: [
          {
            label: 'Exact Trig, Geometry & Area Formulas',
            notesHtml:
              '<h2>Geometry &amp; Trig Essentials</h2><ul><li><b>Trapezium area:</b> ½(a + b)h · <b>Circle:</b> C = πd, A = πr²</li><li><b>Sector area:</b> (θ/360) × πr² · <b>Arc length:</b> (θ/360) × πd</li><li><b>Exact trig:</b> sin 0°=0, sin 30°=½, sin 45°=√2/2, sin 60°=√3/2, sin 90°=1</li></ul>',
            cards: [
              ['Area of a trapezium with parallel sides a and b and height h', '0.5 × (a + b) × h'],
              ['Formula for the volume of any prism', 'Area of cross-section × length'],
              ['What is the sum of interior angles of an n-sided polygon?', '(n − 2) × 180°'],
              ['What is the sum of exterior angles of ANY polygon?', '360°'],
              ['Exact value of cos 30°', '√3 / 2'],
              ['Exact value of sin 45°', '√2 / 2 (or 1 / √2)'],
              ['Exact value of tan 60°', '√3'],
            ],
          },
          {
            label: 'Algebra, Rates & Compound Measures',
            notesHtml:
              '<h2>Rates, Speed &amp; Quadratics</h2><ul><li><b>Speed</b> = Distance ÷ Time · <b>Density</b> = Mass ÷ Volume · <b>Pressure</b> = Force ÷ Area</li><li><b>Pythagoras in 3D:</b> d² = a² + b² + c²</li><li><b>Equation of a circle</b> centred at origin: x² + y² = r²</li></ul>',
            cards: [
              ['State the formula for Density', 'Density = Mass ÷ Volume'],
              ['State the formula for Pressure', 'Pressure = Force ÷ Area'],
              ['Equation of a circle centred at (0, 0) with radius r', 'x² + y² = r²'],
              ['How do you find the gradient between (x₁, y₁) and (x₂, y₂)?', '(y₂ − y₁) ÷ (x₂ − x₁)'],
              ['What is the formula for percentage change?', '(Change ÷ Original value) × 100'],
              ['3D Pythagoras diagonal across a cuboid of sides a, b, c', '√(a² + b² + c²)'],
              ['What does the alternate segment theorem state?', 'The angle between a tangent and a chord equals the angle in the alternate segment'],
            ],
          },
        ],
      },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_bio_paper1_focus',
    title: 'GCSE Biology Paper 1 Focus Pack',
    subtitle:
      'Deep-dive Biology Paper 1 specification pack: Cell Structure, Digestion, Heart & Disease with full notes & recall deck.',
    category: 'notes',
    examBoard: 'AQA / Edexcel Biology',
    tags: ['Biology', 'Notes', 'Paper 1', 'GCSE'],
    highlights: [
      '4 detailed Biology Paper 1 spec subtopics',
      'Structured specification revision notes',
      '12 targeted exam-markscheme flashcards',
    ],
    subjects: [
      {
        name: 'Biology Paper 1',
        topics: [
          {
            label: 'Cell Differentiation & Stem Cells',
            notesHtml:
              '<h2>Specialised Cells &amp; Stem Cells</h2><ul><li><b>Sperm cell:</b> flagellum for swimming, lots of mitochondria for energy, acrosome enzymes to digest egg coat.</li><li><b>Embryonic stem cells:</b> can differentiate into almost any cell type (raises ethical questions).</li><li><b>Adult bone marrow stem cells:</b> limited differentiation (mainly blood cells), fewer ethical concerns.</li></ul>',
            cards: [
              ['Where are stem cells found in plants?', 'In meristem tissue (at root and shoot tips), allowing cloning throughout the plant’s life'],
              ['What is therapeutic cloning?', 'Producing an embryo with the same genes as a patient so stem cells won’t be rejected by the patient’s immune system'],
              ['Why do root hair cells lack chloroplasts?', 'They are underground in the dark, so they cannot carry out photosynthesis; instead they have a large surface area for absorbing water and mineral ions'],
            ],
          },
          {
            label: 'Circulatory System & Gas Exchange',
            notesHtml:
              '<h2>Alveoli &amp; Double Circulation</h2><ul><li><b>Alveoli adaptations:</b> huge surface area, one-cell-thick walls (short diffusion path), good blood supply &amp; ventilation maintaining steep concentration gradient.</li><li><b>CHD Treatments:</b> Stents (keep coronary arteries open), Statins (lower blood cholesterol), Artificial pacemakers.</li></ul>',
            cards: [
              ['List 3 adaptations of alveoli for efficient gas exchange', 'Huge surface area, walls one cell thick (short diffusion distance), and rich capillary blood supply maintaining a steep concentration gradient'],
              ['Compare stents and statins for treating coronary heart disease', 'Stents physically widen a narrowed artery quickly; statins are daily drugs that reduce LDL cholesterol and slow plaque build-up'],
              ['Why is the left ventricle wall thicker than the right ventricle wall?', 'It must pump oxygenated blood at higher pressure all around the entire body, whereas the right ventricle only pumps to the nearby lungs'],
            ],
          },
          {
            label: 'Plant Tissues & Transpiration',
            notesHtml:
              '<h2>Xylem, Phloem &amp; Stomata</h2><ul><li><b>Xylem:</b> dead hollow tubes reinforced with lignin carrying water &amp; mineral ions one-way (transpiration stream).</li><li><b>Phloem:</b> living sieve-tube cells transporting dissolved sugars up and down (translocation).</li><li><b>Transpiration rate increases</b> with higher temperature, light intensity, wind speed, and lower humidity.</li></ul>',
            cards: [
              ['Contrast xylem and phloem transport', 'Xylem transports water & minerals upwards (transpiration stream); phloem transports dissolved sugars in both directions (translocation)'],
              ['Why does higher humidity decrease the rate of transpiration?', 'It reduces the water vapour concentration gradient between inside the leaf and the surrounding air'],
              ['How do guard cells close stomata?', 'They lose water by osmosis, become flaccid, and curve together to close the stomatal pore'],
            ],
          },
        ],
      },
    ],
  }),

  buildStandardPack({
    id: 'std_gcse_business_econ_combo',
    title: 'GCSE Business & Economics Combo',
    subtitle:
      'Marketing mix, break-even, cash flow & operations combined with supply/demand and macroeconomic policy.',
    category: 'combo',
    examBoard: 'Edexcel / OCR GCSE',
    tags: ['Business', 'Economics', 'GCSE Combo', 'Finance'],
    highlights: [
      '2 commerce subjects · 4 specification topics',
      'Key financial formulas & economic policy notes',
      '12 exam-ready definition & formula flashcards',
    ],
    subjects: [
      {
        name: 'Business (GCSE)',
        topics: [
          {
            label: 'Marketing Mix & Enterprise',
            notesHtml:
              '<h2>The 4 Ps &amp; Market Research</h2><ul><li><b>Product, Price, Place, Promotion:</b> must work as an integrated mix matching target segment needs.</li><li><b>Primary research:</b> surveys/focus groups (tailored but costly) vs <b>Secondary:</b> reports/competitor data (cheap, fast, possibly outdated).</li></ul>',
            cards: [
              ['What are the 4 Ps of the marketing mix?', 'Product, Price, Place, Promotion'],
              ['Distinguish between limited and unlimited liability', 'With limited liability, owners only risk losing the money invested in the business; with unlimited liability, personal assets can be seized to pay debts'],
              ['What is price skimming?', 'Setting a high initial price for an innovative product to maximise early revenue before lowering it later'],
            ],
          },
          {
            label: 'Finance & Break-Even',
            notesHtml:
              '<h2>Core Business Formulas</h2><ul><li><b>Revenue</b> = Price × Quantity · <b>Total Costs</b> = Fixed Costs + Variable Costs</li><li><b>Break-even output</b> = Fixed Costs ÷ (Selling Price − Variable Cost per unit)</li><li><b>Margin of safety</b> = Actual sales − Break-even sales</li><li><b>Cash flow vs Profit:</b> Cash flow is timing of money in/out (solvency); profit is revenue minus total costs over a period.</li></ul>',
            cards: [
              ['State the formula for break-even output', 'Fixed Costs ÷ (Selling Price per unit − Variable Cost per unit)'],
              ['How is Gross Profit Margin calculated?', '(Gross Profit ÷ Sales Revenue) × 100'],
              ['Why can a profitable business still fail from poor cash flow?', 'If cash outflows (wages, rent, suppliers) occur before customers pay invoices, the business runs out of cash to pay immediate debts'],
            ],
          },
        ],
      },
      {
        name: 'Economics (GCSE)',
        topics: [
          {
            label: 'Supply, Demand & Market Failure',
            notesHtml:
              '<h2>Price Mechanism &amp; Elasticity</h2><ul><li><b>PED</b> = %Δ Quantity Demanded ÷ %Δ Price. Inelastic (|PED| &lt; 1): essentials/habitual goods; Elastic (|PED| &gt; 1): luxuries with close substitutes.</li><li><b>Equilibrium:</b> where quantity demanded equals quantity supplied.</li></ul>',
            cards: [
              ['State the formula for Price Elasticity of Demand (PED)', '% change in quantity demanded ÷ % change in price'],
              ['If a good has price-inelastic demand and a firm raises price, what happens to total revenue?', 'Total revenue increases because percentage fall in quantity demanded is smaller than the percentage rise in price'],
              ['Give an example of market failure with negative externalities', 'Factory pollution or car emissions, where third parties suffer external costs not paid by producers or consumers'],
            ],
          },
          {
            label: 'Macroeconomics & Policy',
            notesHtml:
              '<h2>Four Macroeconomic Objectives</h2><ul><li>Steady economic growth (GDP), low unemployment, low and stable inflation (~2% CPI), and sustainable balance of payments.</li><li><b>Monetary policy:</b> Bank of England adjusts interest rates (higher rates encourage saving &amp; reduce borrowing/spending).</li><li><b>Fiscal policy:</b> Government taxation and spending.</li></ul>',
            cards: [
              ['Name the UK government’s 4 main macroeconomic objectives', 'Sustainable economic growth, low unemployment, low & stable inflation, and balanced current account'],
              ['How do higher interest rates help reduce inflation?', 'Higher borrowing costs and better returns on saving reduce consumer spending and investment, cooling aggregate demand'],
              ['What is the difference between progressive and regressive taxation?', 'Progressive takes a higher percentage of income as income rises (e.g. income tax); regressive takes a larger percentage from lower earners (e.g. VAT)'],
            ],
          },
        ],
      },
    ],
  }),
];

export function loadCustomPacksFromLocal(): StudyPack[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomPacksToLocal(packs: StudyPack[]): void {
  try {
    localStorage.setItem(CUSTOM_PACKS_STORAGE_KEY, JSON.stringify(packs));
  } catch {
    // ignore
  }
}

export function loadAppliedPackIdsFromLocal(): string[] {
  try {
    const raw = localStorage.getItem(APPLIED_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAppliedPackIdsToLocal(ids: string[]): void {
  try {
    localStorage.setItem(APPLIED_PACKS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}
