// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let startTime = null;
let randomSeed = null;

// Store temporary data during a trial sequence
let trialSequenceData = {};

// Store all consolidated trial data
let consolidatedTrials = [];

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

// Mapping from condition number to sublist ID
const conditionToSublist = {
    0: '1A',
    1: '1B',
    2: '2A',
    3: '2B',
    4: '3A',
    5: '3B',
    6: '4A',
    7: '4B'
};

// Determine which sublist to use
// Priority: 1) URL parameter, 2) Will be set by data pipe condition, 3) default
const sublistParam = getURLParameter('sublist');
let sublistId = '1A'; // default
let conditionNumber = null; // Will be set by data pipe

if (sublistParam) {
    // Check if it matches format like "1A", "2B", etc.
    if (/^[1-4][AB]$/i.test(sublistParam)) {
        sublistId = sublistParam.toUpperCase();
    } else {
        console.warn(`Invalid sublist parameter: ${sublistParam}. Using default sublist 1A.`);
    }
}

// Generate random seed automatically (not from URL)
randomSeed = Math.floor(Math.random() * 1000000);

console.log(`Using sublist: ${sublistId}`);
console.log(`Using random seed: ${randomSeed}`);

// These will be set once sublist is determined
let csvFilename;
let filename;

// Initialize jsPsych
const jsPsych = initJsPsych({});

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
        console.error(`Invalid target index ${targetIndex} for trial ${trialNumber}`);
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
            
            // Initialize trial sequence data
            trialSequenceData = {
                subjCode: getURLParameter('subjCode') || jsPsych.randomization.randomID(10),
                trial_index: trialIndex,
                masking_condition: maskingCondition,
                trial_list: sublistId,
                random_seed: randomSeed,
                real_passage: realSentence,
                jabber_passage: jabberSentence,
                target_word_index: targetIndex,
                target_word: targetWord,
                entropy: trial.entropy,
                target_probability: trial.target_probability
            };
            
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
                // Store time before guess
                trialSequenceData.time_before_guess = Date.now() - startTime;
                jsPsych.finishTrial();
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    return {
        type: jsPsychSurveyText,
        questions: [
            {
                prompt: `<div class="instructions">
                    <p>What do you think the <strong>bolded word</strong> was in the sentence?</p>
                    <p><strong>Type ONE WORD for your guess:</strong></p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_finish: function(data) {
            // Store guess in trial sequence data
            trialSequenceData.guess = data.response.target_word_guess;
            trialSequenceData.time_elapsed = data.time_elapsed;
        }
    };
}

// Function to create confidence rating trial
function createConfidenceRatingTrial(trialIndex) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div style="text-align: center;">
                <p>How confident are you in your guess?</p>
            </div>
        `,
        choices: ['Not at all confident', 'Slightly confident', 'Moderately confident', 'Very confident', 'Extremely confident'],
        on_finish: function(data) {
            // Store confidence rating and RT in trial sequence data
            trialSequenceData.confidence_rating = data.response + 1; // Convert 0-4 to 1-5
            trialSequenceData.confidence_rt = data.rt;
            
            // Add to consolidated trials array
            consolidatedTrials.push({...trialSequenceData});
            
            console.log('Saved consolidated trial:', trialSequenceData);
            console.log('Total consolidated trials so far:', consolidatedTrials.length);
        }
    };
}

// Function to create feedback trial
function createFeedbackTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    
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
        trial_duration: null
    };
}

// Updated LupyanLab consent (up to date as of June 2025)
const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
        <div style="width: 800px; margin: 0 auto; text-align: left">
            <h3>Consent to Participate in Research</h3>
            
            <p>The task you are about to do is sponsored by University of Wisconsin-Madison. It is part of a protocol titled "What are we learning from language?"</p>

            <p>The task you are asked to do involves making simple responses to words and sentences. For example, you may be asked to rate a pair of words on their similarity or to indicate how true you think a given sentence is. More detailed instructions for this specific task will be provided on the next screen.</p>

            <p>This task has no direct benefits. We do not anticipate any psychosocial risks. There is a risk of a confidentiality breach. Participants may become fatigued or frustrated due to the length of the study.</p>

            <p>The responses you submit as part of this task will be stored on a sercure server and accessible only to researchers who have been approved by UW-Madison. Processed data with all identifiers removed could be used for future research studies or distributed to another investigator for future research studies without additional informed consent from the subject or the legally authorized representative.</p>

            <p>You are free to decline to participate, to end participation at any time for any reason, or to refuse to answer any individual question without penalty or loss of earned compensation. We will not retain data from partial responses. If you would like to withdraw your data after participating, you may send an email lupyan@wisc.edu or complete this form which will allow you to make a request anonymously.</p>

            <p>If you have any questions or concerns about this task please contact the principal investigator: Prof. Gary Lupyan at lupyan@wisc.edu.</p>

            <p>If you are not satisfied with response of the research team, have more questions, or want to talk with someone about your rights as a research participant, you should contact University of Wisconsin's Education Research and Social & Behavioral Science IRB Office at 608-263-2320.</p>

            <p><strong>By clicking the box below, I consent to participate in this task and affirm that I am at least 18 years old.</strong></p>
        </div>
    `,
    choices: ['I Agree', 'I Do Not Agree'],
    on_finish: function(data) {
        if(data.response == 1) {
            jsPsych.endExperiment('Thank you for your time. The experiment has been ended.');
        }
    }
};

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
            <p><strong>Some will be harder than others, so just do your best and take your time! </strong></p>
            <h2>Press Any Key to Start Experiment</h2>
        </div>
    `
};

// Function to convert array of objects to CSV
function arrayToCSV(data) {
    if (data.length === 0) return '';
    
    // Get headers from first object
    const headers = Object.keys(data[0]);
    
    // Create CSV rows
    const csvRows = [];
    csvRows.push(headers.join(','));
    
    for (const row of data) {
        const values = headers.map(header => {
            const val = row[header];
            // Escape values that contain commas or quotes
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [consent, welcome, instructions, examples_page1, start_study];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
        timeline.push(createConfidenceRatingTrial(i));
        timeline.push(createFeedbackTrial(i));
    }
    
    // Add "Saving data..." screen
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
            <div style="text-align: center; padding: 50px;">
                <h2>Saving Data...</h2>
                <p style="font-size: 18px; margin-top: 30px;">Please wait, do not close this window.</p>
                <div style="margin-top: 30px;">
                    <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #2196f3; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </div>
        `,
        choices: "NO_KEYS",
        trial_duration: 1000
    });
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "gbHk1YAvpYtc",
        filename: filename,
        data_string: () => {
            console.log('Attempting to save data...');
            console.log('Number of consolidated trials:', consolidatedTrials.length);
            console.log('Sample data:', consolidatedTrials[0]);
            
            // Convert consolidated trials array to CSV
            const csvData = arrayToCSV(consolidatedTrials);
            console.log('CSV preview (first 500 chars):', csvData.substring(0, 500));
            
            return csvData;
        },
        on_finish: function(data) {
            console.log('Data save completed');
            console.log('Save response:', data);
        }
    };
    
    timeline.push(save_data);
    
    // Redirect to Qualtrics with subjCode
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            const subjCode = getURLParameter('subjCode') || 'unknown';
            // Get survey URL from URL parameter or use default
            const surveyURL = getURLParameter('survey_url') || 'https://uwmadison.co1.qualtrics.com/jfe/form/SV_2hiSFCTKI8N4Wbk';
            // Add subjCode to survey URL
            const surveyWithId = `${surveyURL}${surveyURL.includes('?') ? '&' : '?'}subjCode=${subjCode}`;
            
            // Automatically redirect after a short delay
            setTimeout(function() {
                window.location.href = surveyWithId;
            }, 2000);
            
            return `
                <div style="text-align: center; padding: 50px;">
                    <h2>Thank you!</h2>
                    <p style="font-size: 18px; margin: 30px 0;">Your data has been saved successfully.</p>
                    <p style="font-size: 16px; margin: 40px 0;">You will be automatically redirected to the final stage of the study in a moment...</p>
                    <p style="font-size: 14px; color: #666; margin-top: 40px;">
                        If you are not redirected automatically, 
                        <a href="${surveyWithId}" style="color: #2196f3; text-decoration: underline;">click here</a>.
                    </p>
                </div>
            `;
        },
        choices: "NO_KEYS",
        trial_duration: null
    });
    
    return timeline;
}

// Run the experiment
async function createExperiment() {
    try {
        // Get condition from data pipe if not already set by URL parameter
        if (!sublistParam) {
            conditionNumber = await jsPsychPipe.getCondition("gbHk1YAvpYtc");
            console.log(`Retrieved condition from data pipe: ${conditionNumber}`);
            
            if (conditionNumber in conditionToSublist) {
                sublistId = conditionToSublist[conditionNumber];
                console.log(`Condition ${conditionNumber} maps to sublist ${sublistId}`);
            } else {
                console.warn(`Unknown condition number: ${conditionNumber}. Using default sublist 1A.`);
            }
        }
        
        // Now that we have the sublist, set the filenames
        csvFilename = `trial_list_sublist_${sublistId}.csv`;
        const subjCode = getURLParameter('subjCode') || jsPsych.randomization.randomID(10);
        filename = `${subjCode}.csv`;
        
        console.log(`Final sublist: ${sublistId}`);
        console.log(`Subject Code: ${subjCode}`);
        console.log(`CSV filename: ${csvFilename}`);
        console.log(`Output filename: ${filename}`);
        
        // Create and run the timeline
        const timeline = await createTimeline();
        jsPsych.run(timeline);
        
    } catch (error) {
        console.error('Error loading experiment:', error);
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <h2>Error Loading Experiment</h2>
                <p>Could not load trial list for sublist ${sublistId}.</p>
                <p>Please make sure the file ${csvFilename} exists.</p>
                <p>Error: ${error.message}</p>
            </div>
        `;
    }
}

createExperiment();
