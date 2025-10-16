const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Configuration
const CONFIG = {
    MEMBER_ROLE_NAME: 'member', // Change this to your member role name
    VOTING_CHANNEL_ID: '1428195744195543122', // Channel where votes happen
    VOTE_DURATION: 999999, // 5 minutes in milliseconds
    REQUIRED_PERCENTAGE: 50 // 51% required to pass
};

// Store active votes
const activeVotes = new Map();

client.on('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

// When someone joins the server
client.on('guildMemberAdd', async (member) => {
    try {
        await startMembershipVote(member);
    } catch (error) {
        console.error('Error starting membership vote:', error);
    }
});

async function startMembershipVote(newMember) {
    const guild = newMember.guild;
    const votingChannel = guild.channels.cache.get(CONFIG.VOTING_CHANNEL_ID);
    
    if (!votingChannel) {
        console.error('Voting channel not found!');
        return;
    }

    // Get all members with the member role
    const memberRole = guild.roles.cache.find(role => role.name.toLowerCase() === CONFIG.MEMBER_ROLE_NAME.toLowerCase());
    
    if (!memberRole) {
        console.error('Member role not found!');
        return;
    }

    // Count eligible voters (members with the member role)
    const eligibleVoters = memberRole.members.size;
    const requiredVotes = Math.ceil((eligibleVoters * CONFIG.REQUIRED_PERCENTAGE) / 100);

    // Create voting embed
    const voteEmbed = new EmbedBuilder()
        .setTitle('🗳️ New Member Vote')
        .setDescription(`**${newMember.user.tag}** has joined the server!\n\nShould they be granted the **${memberRole.name}** role?`)
        .addFields(
            { name: '👥 Eligible Voters', value: `${eligibleVoters}`, inline: true },
            { name: '✅ Required Yes Votes', value: `${requiredVotes}`, inline: true },
            { name: '⏱️ Time Remaining', value: `${CONFIG.VOTE_DURATION / 60000} minutes`, inline: true }
        )
        .setThumbnail(newMember.user.displayAvatarURL())
        .setColor('#00ff00')
        .setTimestamp();

    // Create voting buttons
    const voteRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`vote_yes_${newMember.id}`)
                .setLabel('✅ Yes')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`vote_no_${newMember.id}`)
                .setLabel('❌ No')
                .setStyle(ButtonStyle.Danger)
        );

    const voteMessage = await votingChannel.send({
        embeds: [voteEmbed],
        components: [voteRow]
    });
await votingChannel.send(`<@&${memberRole.id}> **New member vote started!**`);
    // Store vote data
    const voteData = {
        messageId: voteMessage.id,
        targetMember: newMember,
        yesVotes: new Set(),
        noVotes: new Set(),
        eligibleVoters: eligibleVoters,
        requiredVotes: requiredVotes,
        memberRole: memberRole,
        channel: votingChannel
    };

    activeVotes.set(newMember.id, voteData);

    // Set timer for vote end
    setTimeout(() => {
        endVote(newMember.id);
    }, CONFIG.VOTE_DURATION);
}

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const [action, voteType, targetUserId] = interaction.customId.split('_');
    
    if (action !== 'vote') return;

    const voteData = activeVotes.get(targetUserId);
    if (!voteData) {
        return interaction.reply({ content: 'This vote has already ended.', ephemeral: true });
    }

    // Check if user has member role
    const memberRole = voteData.memberRole;
    if (!interaction.member.roles.cache.has(memberRole.id)) {
        return interaction.reply({ 
            content: `You need the **${memberRole.name}** role to vote.`, 
            ephemeral: true 
        });
    }

    const userId = interaction.user.id;
    
    // Remove from opposite vote if exists
    if (voteType === 'yes') {
        voteData.noVotes.delete(userId);
        voteData.yesVotes.add(userId);
    } else {
        voteData.yesVotes.delete(userId);
        voteData.noVotes.add(userId);
    }

    // Update embed with current vote counts
    await updateVoteEmbed(voteData);

    // Check if vote should end early
    const yesCount = voteData.yesVotes.size;
    const noCount = voteData.noVotes.size;
    const totalVotes = yesCount + noCount;

    // End early if impossible to reach required votes
    const remainingVoters = voteData.eligibleVoters - totalVotes;
    if (yesCount + remainingVoters < voteData.requiredVotes) {
        endVote(targetUserId);
        return interaction.reply({ content: '✅ Vote recorded!', ephemeral: true });
    }

    // End early if required votes reached
    if (yesCount >= voteData.requiredVotes) {
        endVote(targetUserId);
        return interaction.reply({ content: '✅ Vote recorded!', ephemeral: true });
    }

    await interaction.reply({ content: '✅ Vote recorded!', ephemeral: true });
});

async function updateVoteEmbed(voteData) {
    try {
        const message = await voteData.channel.messages.fetch(voteData.messageId);
        const embed = message.embeds[0];
        
        const newEmbed = new EmbedBuilder()
            .setTitle(embed.title)
            .setDescription(embed.description)
            .addFields(
                { name: '👥 Eligible Voters', value: `${voteData.eligibleVoters}`, inline: true },
                { name: '✅ Required Yes Votes', value: `${voteData.requiredVotes}`, inline: true },
                { name: '📊 Current Votes', value: `Yes: ${voteData.yesVotes.size} | No: ${voteData.noVotes.size}`, inline: true }
            )
            .setThumbnail(embed.thumbnail?.url)
            .setColor(embed.color)
            .setTimestamp();

        await message.edit({ embeds: [newEmbed] });
    } catch (error) {
        console.error('Error updating vote embed:', error);
    }

}

async function endVote(targetUserId) {
    const voteData = activeVotes.get(targetUserId);
    if (!voteData) return;

    const yesCount = voteData.yesVotes.size;
    const passed = yesCount >= voteData.requiredVotes;

    try {
        // Update the message to show results
        const message = await voteData.channel.messages.fetch(voteData.messageId);
        
        const resultEmbed = new EmbedBuilder()
            .setTitle('🗳️ Vote Results')
            .setDescription(`**${voteData.targetMember.user.tag}** membership vote has ended!`)
            .addFields(
                { name: '✅ Yes Votes', value: `${yesCount}`, inline: true },
                { name: '❌ No Votes', value: `${voteData.noVotes.size}`, inline: true },
                { name: '📊 Required', value: `${voteData.requiredVotes}`, inline: true },
                { name: '🎯 Result', value: passed ? '**PASSED** ✅' : '**FAILED** ❌', inline: false }
            )
            .setThumbnail(voteData.targetMember.user.displayAvatarURL())
            .setColor(passed ? '#00ff00' : '#ff0000')
            .setTimestamp();

        await message.edit({ 
            embeds: [resultEmbed], 
            components: [] // Remove buttons
        });

        // Grant role if vote passed
        if (passed) {
            await voteData.targetMember.roles.add(voteData.memberRole);
            await voteData.channel.send(`🎉 **${voteData.targetMember.user.tag}** has been granted the **${voteData.memberRole.name}** role!`);
        } else {
            await voteData.channel.send(`❌ **${voteData.targetMember.user.tag}** was not granted the **${voteData.memberRole.name}** role.`);
        }

    } catch (error) {
        console.error('Error ending vote:', error);
    }

    // Clean up
    activeVotes.delete(targetUserId);
}

client.login('MTQyODI1NDUzNjQ1NTI5MDk0MQ.GmYs7N.0OC9n1387dEOp7HB4epNG6P5hxFnKN-hkR44is');