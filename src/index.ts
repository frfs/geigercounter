import { v4 as uuid } from 'uuid';
import Bent from 'bent';
import Dayjs from 'dayjs';
import WebSocket from 'ws';
import ReconnectingWebSocket, { Options } from 'reconnecting-websocket';
import Schedule from 'node-schedule';

require('dotenv').config();

const INSTANCE_DOMAIN = process.env.INSTANCE_DOMAIN;
const TOKEN = process.env.TOKEN;
const TARGET_EMOJIS: Array<string> = (process.env.TARGET_EMOJIS as string).split(' ');

function PostToMisskey(body: string): Promise<Bent.ValidResponse>
{
    const post = Bent(`https://${INSTANCE_DOMAIN}/`, 'POST', 'json', 200);
    return post('api/notes/create', {
        'i': TOKEN,
        'visibility': 'public',
        'text': body,
    });
}

function main(): void
{
    let reactionCounts = new Map<string, number>();

    const wsEndpoint = `wss://${INSTANCE_DOMAIN}/streaming?i=${TOKEN}`;
    const wsOptions: Options = {'WebSocket': WebSocket};
    const wsClient = new ReconnectingWebSocket(wsEndpoint, [], wsOptions);

    wsClient.onopen = () => {
        console.log('WebSocket Opened');
        wsClient.send(JSON.stringify({
            'type': 'connect',
            'body': {
                'channel': 'localTimeline',
                'id': uuid(),
                'params': {},
            }
        }));
    };

    wsClient.onmessage = e => {
        const ret = JSON.parse(e.data);
        if (ret.type === 'channel' && ret.body.type === 'note')
        {
            // 投稿が来た時、その時の終わりまで監視させる
            const postId = ret.body.body.id;
            const captureCancelAt = Dayjs().endOf('hour');
            console.log(`Start capture SubNote. id: ${postId}`);

            wsClient.send(JSON.stringify({
                'type': 'subNote',
                'body': {'id': postId},
            }));

            Schedule.scheduleJob(captureCancelAt.toDate(), () => {
                // 監視キャンセル
                console.log(`End capture SubNote. id: ${postId}`);
                wsClient.send(JSON.stringify({
                    'type': 'unsubNote',
                    'body': {'id': postId},
                }));
            });
        }
        else if (ret.type === 'noteUpdated')
        {
            if (ret.body.type === 'reacted')
            {
                // 自鯖からのリアクションに限る
                const reactionKey = (ret.body.body.reaction as string).replaceAll(':', '');
                const [emojiKey, domain, ..._] = reactionKey.split('@');
                if (domain === '.')
                {
                    // 自鯖からきたリアクションをカウント
                    reactionCounts.set(emojiKey, reactionCounts?.get(emojiKey) ?? 0 + 1);
                }
            }
            else if (ret.body.type === 'unreacted')
            {
                // 自鯖からのリアクションに限る
                const reactionKey = (ret.body.body.reaction as string).replaceAll(':', '');
                const [emojiKey, domain, ..._] = reactionKey.split('@');
                if (domain === '.')
                {
                    // リアクションが外れた時 => それをカウントダウン
                    const reactionCount = reactionCounts?.get(emojiKey) ?? 0;
                    if (reactionCount > 0)
                    {
                        reactionCounts.set(emojiKey, reactionCount - 1);
                        if (reactionCount - 1 <= 0)
                        {
                            reactionCounts.delete(emojiKey);
                        }
                    }
                }
            }
        }
    };

    wsClient.onerror = e => {
        console.error(`Connection Error: ${e.message}`);
    };

    // 毎時ジョブ
    Schedule.scheduleJob('1 * * * *', () => {
        // 数えたリアクション辞書を絞り込む
        let count = 0;
        reactionCounts.forEach((v, k) => {
            if (k in TARGET_EMOJIS)
            {
                count += v;
            }
        });

        PostToMisskey(`ガリガリガリ…\nこの1時間の間に核の絵文字を使ったリアクションは${count}回行われました。`);

        // カウンタリセット
        reactionCounts = new Map<string, number>();
    });
}

main();
