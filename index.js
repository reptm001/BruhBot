//////////////////////////////////////////
//////////////// LOGGING /////////////////
//////////////////////////////////////////
function getCurrentDateString() {
    return (new Date()).toISOString() + ' ::';
};
__originalLog = console.log;
console.log = function () {
    var args = [].slice.call(arguments);
    __originalLog.apply(console.log, [getCurrentDateString()].concat(args));
};
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////

const fs = require('fs');
const util = require('util');
const path = require('path');

//////////////////////////////////////////
///////////////// VARIA //////////////////
//////////////////////////////////////////

function necessary_dirs() {
    if (!fs.existsSync('./temp/')){
        fs.mkdirSync('./temp/');
    }
    if (!fs.existsSync('./data/')){
        fs.mkdirSync('./data/');
    }
}
necessary_dirs()


function clean_temp() {
    const dd = './temp/';
    fs.readdir(dd, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            fs.unlink(path.join(dd, file), err => {
                if (err) throw err;
            });
        }
    });
}
clean_temp(); // clean files at startup

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


async function convert_audio(infile, outfile, cb) {
    try {
        let SoxCommand = require('sox-audio');
        let command = SoxCommand();
        streamin = fs.createReadStream(infile);
        streamout = fs.createWriteStream(outfile);
        command.input(streamin)
            .inputSampleRate(48000)
            .inputEncoding('signed')
            .inputBits(16)
            .inputChannels(2)
            .inputFileType('raw')
            .output(streamout)
            .outputSampleRate(16000)
            .outputEncoding('signed')
            .outputBits(16)
            .outputChannels(1)
            .outputFileType('wav');

        command.on('end', function() {
            streamout.close();
            streamin.close();
            cb();
        });
        command.on('error', function(err, stdout, stderr) {
            console.log('Cannot process audio: ' + err.message);
            console.log('Sox Command Stdout: ', stdout);
            console.log('Sox Command Stderr: ', stderr)
        });

        command.run();
    } catch (e) {
        console.log('convert_audio: ' + e)
    }
}
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////


//////////////////////////////////////////
//////////////// CONFIG //////////////////
//////////////////////////////////////////

const SETTINGS_FILE = 'settings.json';

let DISCORD_TOK = null;
let SPOTIFY_TOKEN_ID = null;
let SPOTIFY_TOKEN_SECRET = null;

function loadConfig() {
    const CFG_DATA = JSON.parse( fs.readFileSync(SETTINGS_FILE, 'utf8') );
    
    DISCORD_TOK = CFG_DATA.discord_token;
}
loadConfig()
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////


const Discord = require('discord.js')
const DISCORD_MSG_LIMIT = 2000;
const discordClient = new Discord.Client()
discordClient.on('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`)
})
discordClient.login(DISCORD_TOK)

const PREFIX = '*';
const _CMD_HELP        = PREFIX + 'help';
const _CMD_JOIN        = PREFIX + 'join';
const _CMD_LEAVE       = PREFIX + 'leave';
const _CMD_DEBUG       = PREFIX + 'debug';
const _CMD_TEST        = PREFIX + 'hello';
const _CMD_TRANSCRIBE  = PREFIX + 'transcribe';

const guildMap = new Map();

let TRANSCRIBE = false;
let UNINTERRUPTED = false;
let LANG = 'en-US';
let GEN = 'MALE';


discordClient.on('message', async (msg) => {
    try {
        if (!('guild' in msg) || !msg.guild) return; // prevent private messages to bot
        const mapKey = msg.guild.id;
        if (msg.content.trim().toLowerCase() == _CMD_JOIN) {
            if (!msg.member.voice.channelID) {
                msg.reply('Error: please join a voice channel first.')
            } else {
                if (!guildMap.has(mapKey))
                    await connect(msg, mapKey)
                else
                    msg.reply('Already connected')
            }
        } else if (msg.content.trim().toLowerCase() == _CMD_LEAVE) {
            if (guildMap.has(mapKey)) {
                let val = guildMap.get(mapKey);
                if (val.voice_Channel) val.voice_Channel.leave()
                if (val.voice_Connection) val.voice_Connection.disconnect()
                if (val.musicYTStream) val.musicYTStream.destroy()
                    guildMap.delete(mapKey)
                msg.reply("Disconnected.")
            } else {
                msg.reply("Cannot leave because not connected.")
            }
        } else if (msg.content.trim().toLowerCase() == _CMD_HELP) {
            msg.reply(getHelpString());
        }
        else if (msg.content.trim().toLowerCase() == _CMD_DEBUG) {
            console.log('toggling debug mode')
            let val = guildMap.get(mapKey);
            if (val.debug)
                val.debug = false;
            else
                val.debug = true;
        }
        else if (msg.content.trim().toLowerCase() == _CMD_TEST) {
            msg.reply('hello back =)')
        }
		else if (msg.content.trim().toLowerCase() == _CMD_TRANSCRIBE) {
            if (TRANSCRIBE == false) {
				TRANSCRIBE = true;
				msg.reply('[Transcribe: ON]');
			} 
			else {
				TRANSCRIBE = false;
				msg.reply('[Transcribe: OFF]');
			}
        }
    } catch (e) {
        console.log('discordClient message: ' + e)
        msg.reply('Error#180: Something went wrong, try again or contact the developers if this keeps happening.');
    }
})

function getHelpString() {
    let out = '**COMMANDS:**\n'
        out += '```'
        out += PREFIX + 'join\n';
        out += PREFIX + 'leave\n';
		out += PREFIX + 'transcribe\n';
        out += '```'
    return out;
}

const { Readable } = require('stream');

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
    this.destroy();
  }
}

async function connect(msg, mapKey) {
    try {
        let voice_Channel = await discordClient.channels.fetch(msg.member.voice.channelID);
        if (!voice_Channel) return msg.reply("Error: The voice channel does not exist!");
        let text_Channel = await discordClient.channels.fetch(msg.channel.id);
        if (!text_Channel) return msg.reply("Error: The text channel does not exist!");
        let voice_Connection = await voice_Channel.join();
        voice_Connection.play(new Silence(), { type: 'opus' });
        guildMap.set(mapKey, {
            'text_Channel': text_Channel,
            'voice_Channel': voice_Channel,
            'voice_Connection': voice_Connection,
            'musicQueue': [],
            'musicDispatcher': null,
            'musicYTStream': null,
            'currentPlayingTitle': null,
            'currentPlayingQuery': null,
            'debug': false,
        });
        speak_impl(voice_Connection, mapKey)
        voice_Connection.on('disconnect', async(e) => {
            if (e) console.log(e);
            guildMap.delete(mapKey);
        })
        msg.reply('connected!')
    } catch (e) {
        console.log('connect: ' + e)
        msg.reply('Error: unable to join your voice channel.');
        throw e;
    }
}

function speak_impl(voice_Connection, mapKey) {
    voice_Connection.on('speaking', async (user, speaking) => {
        if (speaking.bitfield == 0 /*|| user.bot*/) {
            return
        }
        console.log(`I'm listening to ${user.username}`)

        const filename = './temp/audio_' + mapKey + '_' + user.username.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + Date.now() + '.tmp';
        let ws = fs.createWriteStream(filename);

        // this creates a 16-bit signed PCM, stereo 48KHz stream
        const audioStream = voice_Connection.receiver.createStream(user, { mode: 'pcm' })
        audioStream.pipe(ws)

        audioStream.on('error',  (e) => { 
            console.log('audioStream: ' + e)
        });
        ws.on('error',  (e) => { 
            console.log('ws error: ' + e)
        });
        audioStream.on('end', async () => {
            const stats = fs.statSync(filename);
            const fileSizeInBytes = stats.size;
            const duration = fileSizeInBytes / 48000 / 4;
            console.log("duration: " + duration)

            if (duration < 0.2 || duration > 30) {
                console.log("TOO SHORT / TOO LONG; SKPPING")
                fs.unlinkSync(filename)
                return;
            }

            const newfilename = filename.replace('.tmp', '.raw');
            fs.rename(filename, newfilename, (err) => {
                if (err) {
                    console.log('ERROR270:' + err)
                    fs.unlinkSync(filename)
                } else {
                    let val = guildMap.get(mapKey)
					
                    const infile = newfilename;
                    const outfile = newfilename + '.wav';
                    try {
                        convert_audio(infile, outfile, async () => {
                            let out = await transcribe_gcp(outfile);
                            if (out != null)
                                process_commands_query(out, mapKey, user);
                            if (!val.debug) {
                                fs.unlinkSync(infile)
                                fs.unlinkSync(outfile)
                            }
                        })
                    } catch (e) {
                        console.log('tmpraw rename: ' + e)
                        if (!val.debug) {
                            fs.unlinkSync(infile)
                            fs.unlinkSync(outfile)
                        }
                    }
                }

            });


        })
    })
}

//////////////////////////////////////////
///////////// TEXT-TO-SPEECH /////////////
//////////////////////////////////////////
function playFile(file, mapKey) {
	if (UNINTERRUPTED != true) {
		// Play audio file
		let val = guildMap.get(mapKey);
		const dispatcher = val.voice_Connection.play(file);
		dispatcher.on('start', () => {
			if (file == 'avengers.mp3') {
				//UNINTERRUPTED = true;
			}
			console.log(file + ' is now playing!');
		});
		dispatcher.on('finish', () => {
			if (file == 'avengers.mp3') {
				//UNINTERRUPTED = false;
			}
			console.log(file + ' has finished playing!');
		});
		dispatcher.on('error', console.error);
	}
}

let gcptts_lastcallTS = null;
const textToSpeech = require('@google-cloud/text-to-speech');
async function tts(text, mapKey) {
	try {
        // ensure we do not send more than two requests per second
        if (gcptts_lastcallTS != null) {
            let now = Math.floor(new Date());    
            while (now - gcptts_lastcallTS < 500) {
                console.log('sleep')
                await sleep(50);
                now = Math.floor(new Date());
            }
        }
    } catch (e) {
        console.log('transcribe_gcptts 837:' + e)
    }
	try {
        console.log('transcribe_gcptts')
		// Creates a client
		const projectId = 'bruhbot-1594062677949'
		const keyFilename = 'gcp_auth.json'
		const client = new textToSpeech.TextToSpeechClient({projectId, keyFilename});
		// Construct the request
		const request = {
			input: {text: text},
			voice: {languageCode: LANG, ssmlGender: GEN},
			audioConfig: {audioEncoding: 'MP3'},
		};
		// Performs the text-to-speech request
		const [response] = await client.synthesizeSpeech(request);
		// Write the binary audio content to a local file
		const writeFile = util.promisify(fs.writeFile);
		await writeFile('output.mp3', response.audioContent, 'binary');
		console.log('Audio content written to file: output.mp3');
		playFile('output.mp3', mapKey);
        gcptts_lastcallTS = Math.floor(new Date());
    } catch (e) { console.log('transcribe_gcptts 851:' + e) }
}
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////

let bruhMap = new Map();
let gamingMap = new Map();
async function process_commands_query(txt, mapKey, user) {
    if (txt && txt.length) {
		let val = guildMap.get(mapKey);
		if (TRANSCRIBE == true)
			val.text_Channel.send(user.username + ': ' + txt);
		txt = txt.toLowerCase();
		if (txt.includes('avengers assemble')){
			console.log(user);
			if (user.username == 'SoggyNoggins') {
				playFile('avengers.mp3', mapKey);
			}
		}
		if (txt.includes('bro') || txt.includes('bra')) {
			await tts('bruh', mapKey);
			if (bruhMap.has(user)) {
				bruhMap.set(user, bruhMap.get(user) + 1);
			} else {
				bruhMap.set(user, 1);
			}
			let val = guildMap.get(mapKey);
			val.text_Channel.send(user.username + ' is on ' + bruhMap.get(user) + ' bruh(s)')
		}
		if (txt.includes('gaming') || txt.includes('david') || txt.includes('jamie') || txt.includes('cayman') || txt.includes('gay men')) {
			await tts('gay ming', mapKey);
			if (gamingMap.has(user)) {
				gamingMap.set(user, gamingMap.get(user) + 1);
			} else {
				gamingMap.set(user, 1);
			}
			let val = guildMap.get(mapKey);
			val.text_Channel.send(user.username + ' is on ' + gamingMap.get(user) + ' GaYming(s)')
		}
		if (txt.includes('toxic') || txt.includes('talk sec')) {
			await tts('stop chatting shit you mother fucker. su car la mink', mapKey);
		}
		if (txt.includes('nut')) {
			await tts('uh uh uh ah ah uh oh ah uh oh oh oh', mapKey);
		}
		if (txt.includes('smoke')) {
			await tts('ayy 4 20 blaze it homie', mapKey);
		}
		if (txt.includes('69')) {
			await tts('nice', mapKey);
		}
		if (txt.includes('thanos car')) {
			await tts('ahh fuck I lost the game', mapKey);
		}
		if (txt.includes('jason derulo')) {
			playFile('jason.mp3', mapKey);
		}
		if (txt.includes('blicky') || txt.includes('licky') || txt.includes('blakey') || txt.includes('lakey') || txt.includes('wiki')) {
			playFile('gooba.mp3', mapKey);
		}
		if (txt.includes('ball') || txt.includes('bol')) {
			await tts('give me my ball back now before i shank your nan you jammy fucker', mapKey);
		}
		if (txt.includes('set voice')) {
			if (txt.includes(' male') || txt.includes('mail')) {
				GEN = 'MALE';
				await tts('i am now a man', mapKey);
			} 
			if (txt.includes('female')) {
				GEN = 'FEMALE';
				await tts('i am now an enemy', mapKey);
			}
			if (txt.includes('uk') || txt.includes('british') || txt.includes('united kingdom') || txt.includes('england') || txt.includes('english')) {
				LANG = 'en-GB';
				sleep(2000);
				await tts('british', mapKey);
			}
			if (txt.includes('us') || txt.includes('usa') || txt.includes('america') || txt.includes('american')) {
				LANG = 'en-US';
				sleep(2000);
				await tts('american', mapKey);
			}
			if (txt.includes('india') || txt.includes('indian')) {
				LANG = 'en-IN';
				sleep(2000);
				await tts('indian', mapKey);
			}
			if (txt.includes('dutch') || txt.includes('netherlands')) {
				LANG = 'nl-NL';
				sleep(2000);
				await tts('dutch', mapKey);
			}
			if (txt.includes('french') || txt.includes('france')) {
				LANG = 'fr-FR';
				sleep(2000);
				await tts('french', mapKey);
			}
			if (txt.includes('german') || txt.includes('germany')) {
				LANG = 'de-DE';
				sleep(2000);
				await tts('german', mapKey);
			}
			if (txt.includes('italian') || txt.includes('italy')) {
				LANG = 'it-IT';
				sleep(2000);
				await tts('italian', mapKey);
			}
			if (txt.includes('japanese') || txt.includes('japan')) {
				LANG = 'ja-JP';
				sleep(2000);
				await tts('japanese', mapKey);
			}
			if (txt.includes('russian') || txt.includes('russia')) {
				LANG = 'ru-RU';
				sleep(2000);
				await tts('russian', mapKey);
			}
			if (txt.includes('spanish') || txt.includes('spain')) {
				LANG = 'es-ES';
				sleep(2000);
				await tts('spanish', mapKey);
			}
		}
    }
}

//////////////////////////////////////////
//////////////// SPEECH //////////////////
//////////////////////////////////////////
let gcp_lastcallTS = null;
const speech = require('@google-cloud/speech');
async function transcribe_gcp(file) {
    try {
        // ensure we do not send more than one request per second
        if (gcp_lastcallTS != null) {
            let now = Math.floor(new Date());    
            while (now - gcp_lastcallTS < 500) {
                console.log('sleep')
                await sleep(50);
                now = Math.floor(new Date());
            }
        }
    } catch (e) {
        console.log('transcribe_gcp 837:' + e)
    }

    try {
        console.log('transcribe_gcp')
		// Creates a client
		const projectId = 'bruhbot-1594062677949'
		const keyFilename = 'gcp_auth.json'
		const client = new speech.SpeechClient({projectId, keyFilename});
		// Reads a local audio file and converts it to base64
		const fileSync = fs.readFileSync(file);
		const audioBytes = fileSync.toString('base64');
		// The audio file's encoding, sample rate in hertz, and BCP-47 language code
		const audio = {
			content: audioBytes,
		};
		const config = {
			encoding: 'LINEAR16',
			sampleRateHertz: 16000,
			languageCode: 'en-GB',
		};
		const request = {
			audio: audio,
			config: config,
		};
		// Detects speech in the audio file
		const [response] = await client.recognize(request);
		const output = response.results
			.map(result => result.alternatives[0].transcript)
			.join('\n');
        gcp_lastcallTS = Math.floor(new Date());
        console.log(output)
        return output;
    } catch (e) { console.log('transcribe_gcp 851:' + e) }
}
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////

discordClient.on('voiceStateUpdate', function(oldMember, newMember){
	if (!oldMember || !newMember) return;
	const mapKey = newMember.guild.id;
	if (guildMap.has(mapKey)) {
		let val = guildMap.get(mapKey);
		let botChannelID = val.voice_Channel.id;
		if (oldMember.channelID == botChannelID && newMember.channelID == null) {
			console.log(oldMember.member.user.username + ' has disconnected');
			tts('safe travels, fellow gamer', mapKey);
		}
		if (oldMember.channelID == null && newMember.channelID == botChannelID) {
			console.log(oldMember.member.user.username + ' has connected');
			tts('greetings, fellow gamer', mapKey);
		}
		if (newMember.deaf == true && newMember.mute == true) {
			if (newMember.channelID == botChannelID) {
				if (newMember.member.user.username == 'BBWarick') {
					tts('uh oh, harry has gone AF gay', mapKey);
				}
				else {
					tts(newMember.member.nickname.toLowerCase() + ' has gone AFK', mapKey);
				}
			}
		}
		if ((oldMember.deaf == true && newMember.deaf == false) || (oldMember.mute == true && newMember.mute == false)) {
			if (newMember.channelID == botChannelID) {
				if (newMember.member.user.username == 'BBWarick') {
					tts('big suprise, harry is with us again. tho probably not for long', mapKey);
				}
				else {
					tts(newMember.member.nickname.toLowerCase() + ' is with us again', mapKey);
				}
			}
		}
	}
});