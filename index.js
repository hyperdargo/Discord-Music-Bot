const { Client, GatewayDispatchEvents, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ActivityType } = require("discord.js");
const { Riffy } = require("riffy");
const { Spotify } = require("riffy-spotify");
const config = require("./config.js");
const messages = require("./utils/messages.js");
const emojis = require("./emojis.js");

const client = new Client({
    intents: [
        "Guilds",
        "GuildMessages",
        "GuildVoiceStates",
        "GuildMessageReactions",
        "MessageContent",
        "DirectMessages",
    ],
});

const spotify = new Spotify({
    clientId: config.spotify.clientId,
    clientSecret: config.spotify.clientSecret
});

client.riffy = new Riffy(client, config.nodes, {
    send: (payload) => {
        const guild = client.guilds.cache.get(payload.d.guild_id);
        if (guild) guild.shard.send(payload);
    },
    defaultSearchPlatform: "ytmsearch",
    restVersion: "v4",
    plugins: [spotify]
});

// Command definitions with emojis
const commands = [
    { name: 'play <query>', description: 'Play a song or playlist', emoji: '🎵' },
    { name: 'pause', description: 'Pause the current track', emoji: '⏸️' },
    { name: 'resume', description: 'Resume the current track', emoji: '▶️' },
    { name: 'skip', description: 'Skip the current track', emoji: '⏭️' },
    { name: 'stop', description: 'Stop playback and clear queue', emoji: '⏹️' },
    { name: 'queue', description: 'Show the current queue', emoji: '📜' },
    { name: 'volume <0-100>', description: 'Adjust player volume', emoji: '🔊' },
    { name: 'shuffle', description: 'Shuffle the current queue', emoji: '🔀' },
    { name: 'loop', description: 'Toggle queue loop mode', emoji: '🔁' },
    { name: 'remove <position>', description: 'Remove a track from queue', emoji: '❌' },
    { name: 'clear', description: 'Clear the current queue', emoji: '🧹' },
    { name: 'status', description: 'Show player status', emoji: 'ℹ️' },
    { name: 'help', description: 'Show this help message', emoji: '❓' }
];

// Function to update bot presence
function updatePresence(track = null) {
    try {
        client.user.setPresence({
            activities: [{
                name: `${config.prefix}help | Music`, // Will always show this
                type: ActivityType.Listening
            }],
            status: 'online'
        });
    } catch (error) {
        console.error('Error updating presence:', error);
    }
}

client.on("ready", () => {
    client.riffy.init(client.user.id);
    console.log(`${emojis.success} Logged in as ${client.user.tag}`);
    updatePresence();
});

function createMusicButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('pause_resume')
            .setLabel('⏯️ Pause/Resume')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('skip')
            .setLabel('⏭️ Skip')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('stop')
            .setLabel('⏹️ Stop')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('shuffle')
            .setLabel('🔀 Shuffle')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('loop')
            .setLabel('🔁 Loop')
            .setStyle(ButtonStyle.Secondary)
    );
}

function createHelpEmbed() {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${client.user.username} Music Bot Help`)
        .setDescription(`**Prefix:** \`${config.prefix}\`\n**Example:** \`${config.prefix}play <song name>\``)
        .addFields(
            commands.map(cmd => ({
                name: `${cmd.emoji} ${config.prefix}${cmd.name}`,
                value: cmd.description,
                inline: true
            }))
        )
        .setFooter({ text: `DTEmpire Music Bot`, iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
}

client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const musicCommands = ["play", "skip", "stop", "pause", "resume", "queue", "nowplaying", "volume", "shuffle", "loop", "remove", "clear"];
    if (musicCommands.includes(command) && !message.member.voice.channel) {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor('#ff0000')
                    .setDescription(`${emojis.error} You must be in a voice channel!`)
            ]
        });
    }

    try {
        switch (command) {
            case "help":
                return message.reply({ embeds: [createHelpEmbed()] });

            case "play": {
                const query = args.join(" ");
                if (!query) return messages.error(message.channel, "Please provide a search query!");

                const player = client.riffy.createConnection({
                    guildId: message.guild.id,
                    voiceChannel: message.member.voice.channel.id,
                    textChannel: message.channel.id,
                    deaf: true,
                });

                const resolve = await client.riffy.resolve({ query, requester: message.author });
                const { loadType, tracks, playlistInfo } = resolve;

                if (loadType === "playlist") {
                    tracks.forEach(track => {
                        track.info.requester = message.author;
                        player.queue.add(track);
                    });
                    messages.addedPlaylist(message.channel, playlistInfo, tracks);
                } else if (loadType === "search" || loadType === "track") {
                    const track = tracks[0];
                    track.info.requester = message.author;
                    player.queue.add(track);
                    messages.addedToQueue(message.channel, track, player.queue.length);
                } else {
                    return messages.error(message.channel, "No results found!");
                }

                if (!player.playing && !player.paused) player.play();
                break;
            }

            case "skip": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                if (!player.queue.length) return messages.error(message.channel, "No more tracks in queue!");
                
                player.stop();
                messages.success(message.channel, "Skipped the current track!");
                break;
            }

            case "stop": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                
                player.destroy();
                updatePresence();
                messages.success(message.channel, "Stopped the music!");
                break;
            }

            case "pause": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                if (player.paused) return messages.error(message.channel, "Already paused!");
                
                player.pause(true);
                messages.success(message.channel, "Paused the music!");
                break;
            }

            case "resume": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                if (!player.paused) return messages.error(message.channel, "Already playing!");
                
                player.pause(false);
                messages.success(message.channel, "Resumed the music!");
                break;
            }

            case "queue": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                
                const queueChunks = [];
                const chunkSize = 10;
                
                for (let i = 0; i < player.queue.length; i += chunkSize) {
                    queueChunks.push(player.queue.slice(i, i + chunkSize));
                }
                
                if (queueChunks.length > 0) {
                    await messages.queueList(message.channel, queueChunks[0], player.queue.current);
                }
                
                for (let i = 1; i < queueChunks.length; i++) {
                    await messages.queueListContinued(message.channel, queueChunks[i]);
                }
                break;
            }

            case "nowplaying": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player?.queue.current) return messages.error(message.channel, "Nothing is playing!");

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🎶 Now Playing')
                    .setDescription(`[${player.queue.current.info.title}](${player.queue.current.info.uri})`)
                    .addFields(
                        { name: 'Duration', value: messages.formatDuration(player.queue.current.info.length), inline: true },
                        { name: 'Requested by', value: `<@${player.queue.current.info.requester.id}>`, inline: true }
                    )
                    .setThumbnail(messages.getThumbnail(player.queue.current.info.uri));

                const msg = await message.channel.send({ 
                    embeds: [embed],
                    components: [createMusicButtons()] 
                });
                break;
            }

            case "volume": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                
                const volume = parseInt(args[0]);
                if (isNaN(volume)) return messages.error(message.channel, "Please provide a valid number!");
                if (volume < 0 || volume > 100) return messages.error(message.channel, "Volume must be between 0-100!");

                player.setVolume(volume);
                messages.success(message.channel, `Volume set to ${volume}%`);
                break;
            }

            case "shuffle": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                if (player.queue.length < 2) return messages.error(message.channel, "Need at least 2 tracks to shuffle!");
                
                player.queue.shuffle();
                messages.success(message.channel, "Shuffled the queue!");
                break;
            }

            case "loop": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                
                const newMode = player.loop === "none" ? "queue" : "none";
                player.setLoop(newMode);
                messages.success(message.channel, `Loop ${newMode === "queue" ? "enabled" : "disabled"}!`);
                break;
            }

            case "remove": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                
                const position = parseInt(args[0]);
                if (isNaN(position) || position < 1 || position > player.queue.length) {
                    return messages.error(message.channel, `Please provide a valid position (1-${player.queue.length})!`);
                }

                const removed = player.queue.remove(position - 1);
                messages.success(message.channel, `Removed **${removed.info.title}** from queue!`);
                break;
            }

            case "clear": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "Nothing is playing!");
                if (!player.queue.length) return messages.error(message.channel, "Queue is already empty!");
                
                player.queue.clear();
                messages.success(message.channel, "Cleared the queue!");
                break;
            }

            case "status": {
                const player = client.riffy.players.get(message.guild.id);
                if (!player) return messages.error(message.channel, "No active player!");
                
                messages.playerStatus(message.channel, player);
                break;
            }

            default:
                return messages.error(message.channel, `Unknown command! Use ${config.prefix}help for commands.`);
        }
    } catch (error) {
        console.error(error);
        messages.error(message.channel, "An error occurred!");
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: "No music playing!", ephemeral: true });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (member.voice.channelId !== player.voiceChannel) {
        return interaction.reply({ content: "Join the voice channel first!", ephemeral: true });
    }

    try {
        switch (interaction.customId) {
            case 'pause_resume':
                player.pause(!player.paused);
                await interaction.reply({ 
                    content: player.paused ? "⏸️ Paused!" : "▶️ Resumed!", 
                    ephemeral: true 
                });
                break;

            case 'skip':
                if (!player.queue.length) throw new Error("No more tracks!");
                player.stop();
                await interaction.reply({ content: "⏭️ Skipped!", ephemeral: true });
                break;

            case 'stop':
                player.destroy();
                updatePresence();
                await interaction.reply({ content: "⏹️ Stopped!", ephemeral: true });
                break;

            case 'shuffle':
                if (player.queue.length < 2) throw new Error("Need 2+ tracks!");
                player.queue.shuffle();
                await interaction.reply({ content: "🔀 Shuffled!", ephemeral: true });
                break;

            case 'loop':
                const newMode = player.loop === "none" ? "queue" : "none";
                player.setLoop(newMode);
                await interaction.reply({ 
                    content: newMode === "queue" ? "🔁 Loop enabled!" : "🔁 Loop disabled!", 
                    ephemeral: true 
                });
                break;
        }
    } catch (error) {
        await interaction.reply({ 
            content: error.message || "Error!", 
            ephemeral: true 
        });
    }
});

client.riffy.on("nodeConnect", node => {
    console.log(`${emojis.success} Node "${node.name}" connected`);
});

client.riffy.on("nodeError", (node, error) => {
    console.log(`${emojis.error} Node "${node.name}" error: ${error.message}`);
});

client.riffy.on("trackStart", async (player, track) => {
    const channel = client.channels.cache.get(player.textChannel);
    updatePresence(track);
    
    const msg = await messages.nowPlaying(channel, track);
    await msg.edit({ components: [createMusicButtons()] });
});

client.riffy.on("queueEnd", player => {
    const channel = client.channels.cache.get(player.textChannel);
    player.destroy();
    updatePresence();
    messages.queueEnded(channel);
});

client.on("raw", d => {
    if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(d.t)) return;
    client.riffy.updateVoiceState(d);
});

client.login(config.botToken);