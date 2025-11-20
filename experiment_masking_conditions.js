// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let startTime = null;
let randomSeed = null;

// Articles that should not be obscured (still shown as real words in 'all' condition)
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// Get URL parameters
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Seeded random number generator (for reproducible randomization)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    // Linear congruential generator
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
    
    // Shuffle array using Fisher-Yates with seeded random
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Determine which sublist to use based on URL parameter (now accepts "1A", "2B", etc.)
const sublistParam = getURLParameter('sublist');
let sublistId = '1A'; // default

if (sublistParam) {
    // Check if it matches format like "1A", "2B", etc.
    if (/^[1-4][AB]$/i.test(sublistParam)) {
        sublistId = sublistParam.toUpperCase();
    } else {
        console.warn(`Invalid sublist parameter: ${sublistParam}. Using default sublist 1A.`);
    }
}

// Get random seed from URL parameter (for trial randomization)
const seedParam = getURLParameter('seed');
if (seedParam) {
    randomSeed = parseInt(seedParam);
    if (isNaN(randomSeed)) {
        // If seed is not a number, convert string to number
        randomSeed = seedParam.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
} else {
    // Generate random seed if not provided
    randomSeed = Math.floor(Math.random() * 1000000);
}

console.log(`Using sublist: ${sublistId}`);
console.log(`Using random seed: ${randomSeed}`);

const csvFilename = `trial_list_sublist_${sublistId}.csv`;

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on subjCode, sublist, and seed
const subjCode = getURLParameter('subjCode');
const filename = `${subjCode}_sublist${sublistId}_seed${randomSeed}.csv`;

// Function to tokenize sentence into words and punctuation
function tokenizeSentence(sentence) {
    const tokens = [];
    const words = sentence.split(' ');
    
    words.forEach(word => {
        // Match word and trailing punctuation separately
        const match = word.match(/^([^.,!?;:'"]*)([.,!?;:'"]*)$/);
        if (match) {
            const [, wordPart, punctPart] = match;
            if (wordPart) tokens.push(wordPart);
            if (punctPart) {
                // Add each punctuation mark as separate token
                punctPart.split('').forEach(p => tokens.push(p));
            }
        } else {
            tokens.push(word);
        }
    });
    
    return tokens;
}

// Function to find target word index in tokenized sentence
function findTargetWordIndex(tokens, targetWord, targetWordPosition) {
    const cleanTarget = targetWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
    
    // If targetWordPosition is provided and valid, use it to find the nth word token
    if (targetWordPosition !== null && targetWordPosition !== undefined && targetWordPosition !== '') {
        const posNum = typeof targetWordPosition === 'string' ? parseInt(targetWordPosition) : targetWordPosition;
        
        if (!isNaN(posNum) && posNum >= 0) {
            let wordCount = 0;
            for (let i = 0; i < tokens.length; i++) {
                // Skip punctuation tokens
                if (!/^[.,!?;:'"]$/.test(tokens[i])) {
                    if (wordCount === posNum) {
                        return i;
                    }
                    wordCount++;
                }
            }
            console.warn(`Could not find word at position ${posNum}, falling back to text search`);
        }
    }
    
    // Fall back to searching for the target word by text
    for (let i = 0; i < tokens.length; i++) {
        // Skip punctuation tokens
        if (!/^[.,!?;:'"]$/.test(tokens[i])) {
            const cleanToken = tokens[i].toLowerCase().replace(/[.,!?;:'"]/g, '');
            if (cleanToken === cleanTarget) {
                return i;
            }
        }
    }
    
    console.error(`Could not find target word '${targetWord}' in sentence`);
    return -1;
}

// Function to load and randomize CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        Papa.parse(csvFilename, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: function(results) {
                console.log('Loaded CSV data:', results.data);
                
                if (results.data.length === 0) {
                    reject(new Error('CSV file is empty'));
                    return;
                }
                
                const requiredColumns = ['passage_variant', 'jabber_passage', 'target_word', 'masking_condition'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                // Store original data
                const originalData = results.data;
                
                // Randomize trial order using seeded random
                const rng = new SeededRandom(randomSeed);
                trialData = rng.shuffle(originalData);
                
                console.log(`Successfully loaded ${trialData.length} trials from sublist ${sublistId}`);
                console.log(`Randomized with seed ${randomSeed}`);
                
                // Log first few for debugging
                console.log('First trial structure:', trialData[0]);
                
                resolve();
            },
            error: function(error) {
                console.error('Error loading CSV:', error);
                reject(error);
            }
        });
    });
}

// Function to create word reveal trial (now just displays, no clicking)
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    // Parse the passages
    const realSentence = trial.passage_variant || trial.ground_truth_sentence || '';
    const jabberSentence = trial.jabber_passage || trial.nonsense_sentence || '';
    
    const realTokens = tokenizeSentence(realSentence);
    const jabberTokens = tokenizeSentence(jabberSentence);
    
    // Get target word and find its position
    const targetWord = trial.target_word;
    const targetPos = trial.target_pos || trial.target_word_index;
    const targetIndex = findTargetWordIndex(realTokens, targetWord, targetPos);
    
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    const maskingCondition = trial.masking_condition || 'all'; // Default to 'all' if missing
    
    // Debug logging
    console.log(`Trial ${trialNumber}:`, {
        targetWord,
        targetPos,
        targetIndex,
        maskingCondition,
        realTokensCount: realTokens.length,
        jabberTokensCount: jabberTokens.length
    });
    
    // Validation
    if (targetIndex < 0 || targetIndex >= realTokens.length) {
        console.error(`Invalid target index ${targetIndex} for trial ${originalTrialNumber}`);
    }
    
    // Verify token counts match
    if (realTokens.length !== jabberTokens.length) {
        console.warn(`Token count mismatch: real=${realTokens.length}, jabber=${jabberTokens.length}`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            startTime = Date.now();
            
            let html = `
                <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                <div class="sentence-container" id="sentence-container">
            `;
            
            // Build sentence based on masking condition
            for (let index = 0; index < jabberTokens.length; index++) {
                let displayToken = '';
                let isTarget = false;
                
                // Check if this is punctuation
                const isPunctuation = /^[.,!?;:'"]$/.test(jabberTokens[index]);
                
                if (isPunctuation) {
                    // Always show punctuation
                    displayToken = jabberTokens[index];
                } else if (index === targetIndex) {
                    // Target word: always show as jabberwocky and bold
                    displayToken = jabberTokens[index];
                    isTarget = true;
                } else {
                    // Non-target, non-punctuation word
                    const cleanJabber = jabberTokens[index].toLowerCase().replace(/[.,!?;:'"]/g, '');
                    const cleanReal = realTokens[index].toLowerCase().replace(/[.,!?;:'"]/g, '');
                    
                    if (maskingCondition === 'none') {
                        // NONE condition: show all real words except target
                        displayToken = realTokens[index];
                    } else {
                        // ALL condition: show jabberwocky, except for articles
                        if (articles.includes(cleanJabber) || articles.includes(cleanReal) || cleanJabber === cleanReal) {
                            // This is an article or same in both - show real word
                            displayToken = realTokens[index];
                        } else {
                            // Regular word - show jabberwocky
                            displayToken = jabberTokens[index];
                        }
                    }
                }
                
                if (isTarget) {
                    html += `<span class="word target">${displayToken}</span>`;
                } else {
                    html += `<span class="word">${displayToken}</span>`;
                }
                
                // Add space after word (except for punctuation)
                if (!isPunctuation && index < jabberTokens.length - 1) {
                    html += ' ';
                }
            }
            
            html += `
                </div>
                <div class="controls">
                    <button class="guess-button" id="guess-btn">Make Guess</button>
                </div>
            `;
            
            return html;
        },
        choices: ['Make Guess'],
        button_html: '<button class="jspsych-btn" style="display: none;">%choice%</button>',
        on_load: function() {
            document.getElementById('guess-btn').addEventListener('click', function() {
                jsPsych.finishTrial({
                    trial_type: 'word-display',
                    trial_number: trialNumber,
                    original_trial_number: originalTrialNumber,
                    randomization_position: trialIndex + 1,
                    sublist: sublistId,
                    random_seed: randomSeed,
                    masking_condition: maskingCondition,
                    target_word_index: targetIndex,
                    target_word: trial.target_word,
                    entropy: trial.entropy,
                    target_probability: trial.target_probability,
                    time_before_guess: Date.now() - startTime,
                    jabber_sentence: jabberSentence,
                    real_sentence: realSentence
                });
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    const maskingCondition = trial.masking_condition || 'all';
    
    return {
        type: jsPsychSurveyText,
        questions: [
            {
                prompt: `<div class="instructions">
                    <p>What do you think the <strong>bolded word</strong> was in the sentence?</p>
                    <p>Type your guess below:</p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_finish: function(data) {
            data.trial_type = 'guess-input';
            data.trial_number = trialNumber;
            data.original_trial_number = originalTrialNumber;
            data.randomization_position = trialIndex + 1;
            data.sublist = sublistId;
            data.random_seed = randomSeed;
            data.masking_condition = maskingCondition;
            data.correct_target_word = trial.target_word;
            data.target_word_index = trial.target_pos || trial.target_word_index;
            data.entropy = trial.entropy;
            data.target_probability = trial.target_probability;
            data.jabber_sentence = trial.jabber_passage || trial.nonsense_sentence;
            data.real_sentence = trial.passage_variant || trial.ground_truth_sentence;
            
            const guess = data.response.target_word_guess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            data.guess_correct = guess === correct;
            
            data.guess_length = data.response.target_word_guess.length;
            data.target_word_length = trial.target_word.length;
        }
    };
}

// Function to create confidence rating trial
function createConfidenceRatingTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    const maskingCondition = trial.masking_condition || 'all';
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div style="text-align: center;">
                <p>How confident are you in your guess?</p>
            </div>
        `,
        choices: ['Not at all confident', 'Slightly confident', 'Moderately confident', 'Very confident', 'Extremely confident'],
        on_finish: function(data) {
            data.trial_type = 'confidence-rating';
            data.trial_number = trialNumber;
            data.original_trial_number = originalTrialNumber;
            data.randomization_position = trialIndex + 1;
            data.sublist = sublistId;
            data.random_seed = randomSeed;
            data.masking_condition = maskingCondition;
            data.confidence_rating = data.response + 1; // Convert 0-4 to 1-5
            
            // Add trial info
            data.target_word = trial.target_word;
            data.entropy = trial.entropy;
            data.target_probability = trial.target_probability;
        }
    };
}

// Function to create feedback trial
function createFeedbackTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const maskingCondition = trial.masking_condition || 'all';
    
    return {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            const targetWord = trial.target_word;
            return `
                <div style="text-align: center; max-width: 600px; margin: 0 auto; padding: 40px;">
                    <h2>Great job!</h2>
                    <p style="font-size: 18px; margin: 30px 0;">The target word was:</p>
                    <p style="font-size: 36px; font-weight: bold; margin: 30px 0;">${targetWord}</p>
                    <p style="margin-top: 40px; font-size: 14px; color: #666;"><em>Press any key to continue</em></p>
                </div>
            `;
        },
        trial_duration: null,
        on_finish: function(data) {
            data.trial_type = 'feedback';
            data.trial_number = trialNumber;
            data.sublist = sublistId;
            data.random_seed = randomSeed;
            data.masking_condition = maskingCondition;
        }
    };
}

// Welcome screen
const welcome = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h1>Word Guessing Experiment</h1>
            <p>In this experiment, you will be trying to guess the meaning of a <strong>bolded</strong> word.</p>
            <p>Sometimes you'll see sentences with all nonsense words, and sometimes you'll see normal sentences with just one nonsense word.</p>
            <p>This might be quite difficult at times! <strong>Please take your time and do your best to guess the word </strong></p>
            <p><em>Press any key to continue</em></p>
        </div>
    `
};

// Instructions
const instructions = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>Instructions</h2>
            <p>On each trial:</p>
            <ol>
                <li>You'll see a sentence with one <strong>bolded word</strong> - this is your target word to guess</li>
                <li>Read the sentence carefully to understand the context</li>
                <li>When you think you know the meaning of the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word</li>
                <li>Rate your confidence in your guess</li>
                <li>You'll see feedback showing the correct answer</li>
            </ol>
            <p><strong>Important: Try to be as specific as possible in your guesses. Your guess should be ONE WORD!</strong></p>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Instructions
const examples_page1 = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>When are you ready to guess?</h2>
            
            <p><strong>This will sometimes be quite difficult, but just do your best!</strong></p>
            
            <p>For example, you might see something like this:</p>
            
            <p style="margin-left: 20px; font-style: italic;">
                "The glorp tafed in the deng zirp <strong>glosh</strong>."
            </p>
            
            <p>Take some time to think about what "glosh" might mean and once you have your best ONE WORD GUESS, you can move forward.</p>
            
            <p style="margin-top: 30px;"><em>Press any key to continue</em></p>
        </div>
    `
};

const start_study = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <p><strong>Final Reminder: Please use ONE WORD GUESSES! </strong></p>
            <p><strong>Some will be harder and some will be easier, so just do your best and take your time! </strong></p>
            <h2>Press Any Key to Start Experiment</h2>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, instructions, examples_page1, start_study];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
        timeline.push(createConfidenceRatingTrial(i));
        timeline.push(createFeedbackTrial(i));
    }
    
    // Add experiment metadata
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            jsPsych.data.addProperties({
                experiment_version: '3.0_masking_conditions',
                sublist: sublistId,
                random_seed: randomSeed,
                subjCode: subjCode,
                completion_time: new Date().toISOString()
            });
        }
    });
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "gbHk1YAvpYtc",
        filename: filename,
        data_string: () => jsPsych.data.get().csv()
    };
    
    timeline.push(save_data);
    
    // Thank you message with survey link
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            // Get survey URL from URL parameter or use default
            const surveyURL = getURLParameter('survey_url') || 'https://uwmadison.co1.qualtrics.com/jfe/form/SV_0VC8tugavHYnhoa';
            // Add subjCode to survey URL
            const surveyWithId = `${surveyURL}${surveyURL.includes('?') ? '&' : '?'}subjCode=${subjCode}`;
            
            return `
                <div style="text-align: center;">
                    <h2>Thank you!</h2>
                    <p>You have completed the experiment.</p>
                    <p>Your data has been saved.</p>
                    <p>Please click the link below to complete a brief survey:</p>
                    <p style="margin-top: 30px;">
                        <a href="${surveyWithId}" target="_blank" style="font-size: 18px; padding: 15px 30px; background-color: #2196f3; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Go to Survey
                        </a>
                    </p>
                    <p style="margin-top: 30px; font-size: 14px; color: #666;">
                        Press any key after completing the survey to close this window.
                    </p>
                </div>
            `;
        }
    });
    
    return timeline;
}

// Run the experiment
createTimeline().then(timeline => {
    jsPsych.run(timeline);
}).catch(error => {
    console.error('Error loading experiment:', error);
    document.body.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <h2>Error Loading Experiment</h2>
            <p>Could not load trial list for sublist ${sublistId}.</p>
            <p>Please make sure the file ${csvFilename} exists.</p>
            <p>Error: ${error.message}</p>
        </div>
    `;
});