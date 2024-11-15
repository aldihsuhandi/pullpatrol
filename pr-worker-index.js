const axios = require('axios');
const moment = require('moment');
const cron = require('node-cron');

require('dotenv').config();

const BITBUCKET_ACCESS_TOKEN = process.env.BITBUCKET_ACCESS_TOKEN;
const BITBUCKET_WORKSPACE = process.env.BITBUCKET_WORKSPACE

const DING_ROBOT_ACCESS_TOKEN = process.env.DING_ROBOT_ACCESS_TOKEN;

const CRON_SCHEDULER = process.env.CRON_SCHEDULER;


/**
 * Schedules the main function to run every x minutes using cron.
 *
 * This is configurable through env variable
 */
cron.schedule(CRON_SCHEDULER, () => {
    main();
})

// Main function to fetch pull requests and send the DingTalk message
async function main() {
    try {
        const repositoriesData = await fetchAllPullRequests();
        await sendToDingTalk(repositoriesData);
    } catch (error) {
        console.error('Error in main function:', error.message);
    }
}

/**
 * Fetches all open pull requests from Bitbucket across multiple repositories.
 *
 * This function fetches pull request data for all the repositories specified,
 * processes the information, and stores it in a structured format.
 *
 * @returns {Promise<Array>} A promise that resolves with an array of repository data,
 * containing repository name and a list of pull requests.
 * @throws {Error} Throws an error if fetching pull requests from Bitbucket fails.
 */
async
async function fetchAllPullRequests() {
    const header = { 'Authorization': `Bearer ${BITBUCKET_ACCESS_TOKEN}` };
    const queryParams = { "state": 'OPEN' };
    const repositories =  process.env.BITBUCKET_REPOSITORIES ? process.env.BITBUCKET_REPOSITORIES.split(',') : [];

    let repositoriesData = [];

    for (const repo of repositories) {
        const url = `https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${repo}/pullrequests`;
        let pullRequests = [];
        let nextUrl = url;

        while (nextUrl) {
            try {
                const response = await axios.get(nextUrl, {
                    headers: header,
                    params: queryParams
                });

                // Process each PR and push to the repository data
                response.data.values.forEach(pr => {
                    const createdOn = moment(pr.created_on);
                    const mergedOn = pr.merged_on ? moment(pr.merged_on) : null;
                    const duration = Math.floor(moment.duration(moment().diff(createdOn)).asDays());

                    const prData = {
                        id: '#' + pr.id,
                        title: pr.title,
                        link: pr.links.html.href,
                        duration,
                        created: createdOn.format('YYYY-MM-DD HH:mm:ss'),
                        merged: mergedOn ? mergedOn.format('YYYY-MM-DD HH:mm:ss') : 'Not Merged',
                        sourceBranch: pr.source.branch.name,
                        destinationBranch: pr.destination.branch.name,
                        commentCount: pr.comment_count,
                        author: pr.author.nickname
                    };

                    pullRequests.push(prData);
                });

                // Check for next page
                nextUrl = response.data.next || null;
            } catch (error) {
                console.error('Error fetching pull requests:', error.message);
                break;
            }
        }

        // Push to repositories bucket
        repositoriesData.push({
            repo: repo,
            pullRequests: pullRequests
        });
    }

    return repositoriesData;
}

/**
 * Constructs the DingTalk message content based on the pull request data.
 *
 * This function generates a text message in a format suitable for DingTalk.
 * It provides a list of pending pull requests across multiple repositories.
 *
 * @param {Array} repositoriesData An array of repository data containing pull requests.
 * @returns {Object} The DingTalk message object with the constructed message content.
 * @throws {Error} Throws an error if the message construction fails.
 */
function createDingTalkMessage(repositoriesData) {
    // Create a message content
    let prMessages = repositoriesData
        .filter(repo => repo.pullRequests && repo.pullRequests.length > 0)
        .map(repo => {
            let repoMessage = `**${repo.repo}**\n`;

            repo.pullRequests.forEach((pr, index) => {
                repoMessage += `${index + 1}. ${pr.id} [${pr.title}] → ${pr.link}\n`
                repoMessage += pr.duration > 0 ? `Duration: ${pr.duration} day\n` : ''
                repoMessage += pr.commentCount > 0 ? `Comments: ${pr.commentCount}\n\n` : '\n'
            });

            return repoMessage;
        }).join('\n\n');

    // Construct the final DingTalk message
    return {
        msgtype: 'text',
        text: {
            content: `Hi Team Dear developers, \n\nPlease review the following pending pull requests. Approve them accordingly, or close them if they are no longer relevant.\n\n${prMessages}\n\nThank you.`
        },
        at: {
            isAtAll: true
        }
    };
}

/**
 * Sends a DingTalk notification with pull request information.
 *
 * This function takes the data of repositories and their respective pull requests,
 * constructs a message, and sends it to a DingTalk webhook.
 *
 */
 async function sendToDingTalk(repositoriesData) {
    const dingWebhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=${DING_ROBOT_ACCESS_TOKEN}`;
    const message = createDingTalkMessage(repositoriesData);

    try {
        const response = await axios.post(dingWebhookUrl, message);
        console.log('DingTalk notification sent successfully:', response.data);
    } catch (error) {
        console.error('Error sending DingTalk notification:', error.message);
    }
}