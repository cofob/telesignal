import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type { CallRecord, ConversationRecord, NewMessageRecord, NewStoryRecord } from '../db/MessageDb';
import type { GroupMember, GroupState } from '../groups/fetchGroup';
import type { StoryMessageSchema as StoryMessageSchemaType } from '../proto/generated/SignalService_pb';
import type SignalStore from '../store/SignalStore';

import { bufferToBase64Url } from '../../../util/encoding/base64';
import { bufferFromHex, bufferToHex } from '../../../util/encoding/buffer';
import { buildStickerPackLink } from '../../../util/signalLinks';
import { STORY_BACKGROUNDS } from '../../../util/storyBackgrounds';
import { saveAttachmentBlob } from '../attachments/attachmentCache';
import { getRandomBytes } from '../crypto';
import { buildAccessControl } from '../groups/fetchGroup';
import { buildGroupInviteLink } from '../groups/inviteLinks';
import { DEFAULT_PROFILE_COLOR } from '../notificationProfiles/notificationProfiles';
import { getKnownStickerPacks } from '../stickers/stickerPacks';
import { MY_STORY_ID, STORY_LIFETIME_MS } from '../stories/storyLists';
import { wasm } from '../wasm';

import {
  ChatStyle_BubbleColorPreset, ChatStyle_WallpaperPreset,
} from '../proto/generated/Backup_pb';
import { Member_Role } from '../proto/generated/Groups_pb';
import {
  AttachmentPointer_Flags,
  AttachmentPointerSchema,
  BodyRange_Style,
  DataMessage_Contact_Phone_Type,
  DataMessage_Payment_Activation_Type,
  DataMessageSchema,
  StoryMessageSchema,
  TextAttachment_Style,
  Verified_State,
} from '../proto/generated/SignalService_pb';

const MINUTE = 60 * 1000;
const PHOTO_WIDTH = 1280;
const PHOTO_HEIGHT = 960;
const PHOTO_MIME_TYPE = 'image/jpeg';
const TRAIL_WIDTH = 24;
// Trail points as fractions of the photo size
const TRAIL_POINTS = [[0.1, 0.85], [0.35, 0.45], [0.6, 0.7], [0.9, 0.15]];
const SUN_RADIUS = 120;
const SUN_CENTER_Y = 0.7 * PHOTO_HEIGHT;
// Story photos are portrait, as phones take them
const STORY_PHOTO_WIDTH = 720;
const STORY_PHOTO_HEIGHT = 1280;
const PEAKS = [[0, 0.75], [0.3, 0.4], [0.5, 0.6], [0.75, 0.3], [1, 0.7]];
const LAKE_TOP = 0.55 * PHOTO_HEIGHT;
// Zozo the French Bulldog, from Signal's artist series
const DEMO_STICKER_PACK_INDEX = 2;
const DEMO_STICKER_ID = 0;
const STICKER_SIZE = 512;
const STICKER_MIME_TYPE = 'image/webp';
const SMILEY_RADIUS = 220;
const SMILEY_EYE_OFFSET = 70;
const SMILEY_EYE_RADIUS = 28;
const SMILEY_MOUTH_RADIUS = 120;
// 32 bytes of entropy and the 16-byte id of a username link, a group's master key and its link password
const DEMO_USERNAME_LINK_LENGTH = 48;
const DEMO_KEY_LENGTH = 32;
const DEMO_PASSWORD_LENGTH = 16;
const DEMO_PROFILE_ID_LENGTH = 16;
// Generated audio: 16-bit mono PCM in a WAV file
const AUDIO_SAMPLE_RATE = 8000;
const AUDIO_BYTES_PER_SAMPLE = 2;
const WAV_HEADER_LENGTH = 44;
const AUDIO_AMPLITUDE = 0.3 * 0x7fff;
const VOICE_DURATION_S = 3;
const VOICE_FREQUENCY = 220;
// Syllables of the voice note, per second
const VOICE_SYLLABLE_RATE = 4;
const TUNE_NOTES = [262, 294, 330, 349, 392, 440, 494, 523];
const TUNE_NOTE_DURATION_S = 0.5;
const WAVEFORM_LENGTH = 48;
// Generated video: a ball crossing a frame, recorded from a canvas
const VIDEO_WIDTH = 480;
const VIDEO_HEIGHT = 270;
const VIDEO_DURATION_MS = 2000;
const VIDEO_FPS = 30;
const MS_PER_SECOND = 1000;
const VIDEO_BALL_RADIUS = 40;
const GIF_SIZE = 240;
const VIDEO_MIME_TYPE = 'video/mp4';

type DemoMessage = Omit<NewMessageRecord, 'conversationId' | 'receivedAt' | 'body' | 'dataMessage' | 'kind'> & {
  kind?: NewMessageRecord['kind'];
  dataMessage?: MessageInitShape<typeof DataMessageSchema>;
};

type DemoStory = Omit<NewStoryRecord, 'conversationId' | 'receivedAt' | 'expiresAt' | 'storyMessage'> & {
  storyMessage: MessageInitShape<typeof StoryMessageSchemaType>;
};

/**
 * Fills the stores with a fake account, contacts, a group, messages and stories, so the UI can be checked without
 * a phone. The account has `isDemo`, so the client never connects. Attachments, the sticker included, are drawn and
 * cached locally or marked unavailable, so seeding makes no requests; the sticker's pack downloads only when it is
 * opened. Reload the page afterwards.
 */
export async function seedDemo(store: SignalStore, db: MessageDb) {
  await store.clear();
  await db.clear();

  const trailPhoto = await createDemoPhoto('demo-photo', drawTrailMap);
  const viewOncePhoto = await createDemoPhoto('demo-view-once-photo', drawSunset);
  const mountainsPhoto = await createDemoPhoto(
    'demo-story-mountains', drawMountains, STORY_PHOTO_WIDTH, STORY_PHOTO_HEIGHT,
  );
  const lakePhoto = await createDemoPhoto('demo-story-lake', drawSunset, STORY_PHOTO_WIDTH, STORY_PHOTO_HEIGHT);
  const albumPhotos = [
    await createDemoPhoto('demo-album-trail', drawTrailMap),
    await createDemoPhoto('demo-album-sunset', drawSunset),
    await createDemoPhoto('demo-album-lake', drawLake),
  ];
  const previewPhoto = await createDemoPhoto('demo-preview', drawLake);
  const sticker = await createDemoSticker();
  const voiceNote = await createDemoVoiceNote();
  const tune = await createDemoAttachment('demo-tune', createWav(createTuneSamples()), {
    fileName: 'Scale.wav', audioDurationSeconds: TUNE_NOTES.length * TUNE_NOTE_DURATION_S,
  });
  const guide = await createDemoAttachment('demo-guide', createPdf('Trail guide: 10 km loop, start at 10am'), {
    fileName: 'Trail guide.pdf',
  });
  const video = await createDemoVideo('demo-video', VIDEO_WIDTH, VIDEO_HEIGHT, { fileName: 'Hike.mp4' });
  const gif = await createDemoVideo('demo-gif', GIF_SIZE, GIF_SIZE, { flags: AttachmentPointer_Flags.GIF });

  const me = crypto.randomUUID();
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const carol = crypto.randomUUID();
  const dave = crypto.randomUUID();
  const eve = crypto.randomUUID();
  const frank = crypto.randomUUID();
  const linda = crypto.randomUUID();
  const now = Date.now();
  const demoPni = `PNI:${crypto.randomUUID()}`;

  await store.setItem('account', {
    aci: me,
    defaultChatStyle: { bubbleColorPreset: ChatStyle_BubbleColorPreset.SOLID_INDIGO },
    deviceId: 2,
    deviceName: 'TeleSignal (demo)',
    password: 'demo',
    registrationId: 1,
    pniRegistrationId: 1,
    profileKey: getRandomBytes(32),
    // The keys that backups come from
    accountEntropyPool: wasm.AccountEntropyPool_Generate(),
    mediaRootBackupKey: getRandomBytes(DEMO_KEY_LENGTH),
    isReadReceiptsEnabled: true,
    usernameLink: { entropy: getRandomBytes(32), serverId: crypto.randomUUID() },
    isStoryViewReceiptsEnabled: true,
    isDemo: true,
  });
  await store.setItem('storyDistributionLists', [
    {
      id: MY_STORY_ID, name: '', memberAcis: [dave], areRepliesAllowed: true, isBlockList: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Hiking club',
      memberAcis: [alice, bob],
      areRepliesAllowed: true,
      isBlockList: false,
    },
  ]);
  // Identity keys give safety numbers; Alice's is verified
  await store.setItem('aciIdentityKeyPair', generateKeyPair());
  await store.setIdentity(alice, { publicKey: generateKeyPair().publicKey, verified: Verified_State.VERIFIED });
  await store.setIdentity(bob, { publicKey: generateKeyPair().publicKey });

  const conversations: ConversationRecord[] = [
    {
      id: me,
      localId: 1,
      type: 'private',
      profileName: 'Demo',
      profileFamilyName: 'User',
      username: 'demo.01',
      about: 'Testing TeleSignal',
      aboutEmoji: '🧪',
      unreadCount: 0,
    },
    {
      id: alice,
      localId: 2,
      type: 'private',
      profileName: 'Alice',
      profileFamilyName: 'Johnson',
      systemName: 'Alice Johnson',
      e164: '+15550100001',
      about: 'Coffee first',
      unreadCount: 0,
      isAccepted: true,
      pinIndex: 0,
    },
    {
      id: bob, localId: 3, type: 'private', profileName: 'Bob', username: 'bob.42', unreadCount: 0, isAccepted: true,
    },
    {
      id: carol,
      localId: 4,
      type: 'private',
      profileName: 'Carol',
      profileFamilyName: 'Diaz',
      unreadCount: 2,
      isAccepted: true,
      mutedUntil: now + 24 * 60 * MINUTE,
    },
    {
      id: dave, localId: 5, type: 'private', profileName: 'Dave', unreadCount: 1,
    },
    {
      id: btoa(String.fromCharCode(...getRandomBytes(32))),
      localId: 6,
      type: 'group',
      masterKey: getRandomBytes(32),
      revision: 3,
      title: 'Weekend trip',
      description: 'Saturday hike and picnic',
      memberAcis: [me, alice, bob, carol],
      adminAcis: [alice],
      unreadCount: 1,
      isAccepted: true,
    },
    // A message request from a group whose members we do not know
    {
      id: btoa(String.fromCharCode(...getRandomBytes(32))),
      localId: 7,
      type: 'group',
      masterKey: getRandomBytes(32),
      revision: 1,
      title: 'Crypto giveaway',
      memberAcis: [me, frank],
      adminAcis: [frank],
      unreadCount: 1,
    },
    {
      id: frank, localId: 8, type: 'private', profileName: 'Frank', unreadCount: 0,
    },
    {
      id: eve, localId: 9, type: 'private', profileName: 'Eve', e164: '+15550100009', unreadCount: 0, isBlocked: true,
    },
    {
      id: linda,
      localId: 10,
      type: 'private',
      profileName: 'Linda',
      about: 'Message me: https://signal.me/#p/+15550100001',
      unreadCount: 0,
      isAccepted: true,
    },
    // A group we administer, with member labels and invitations, and one an admin ended
    buildDemoGroup(11, 'Book club', me, [
      { aci: me, role: Member_Role.ADMINISTRATOR, label: 'Organizer', labelEmoji: '📚' },
      { aci: alice, role: Member_Role.ADMINISTRATOR },
      { aci: bob, label: 'Poetry' },
      { aci: carol, label: 'Snacks', labelEmoji: '🍪' },
    ], now - 30 * MINUTE, [
      { serviceId: dave, addedBy: me },
      { serviceId: demoPni, addedBy: me },
    ]),
    buildDemoGroup(12, 'Old project', me, [
      { aci: me },
      { aci: alice, role: Member_Role.ADMINISTRATOR },
    ], now - 50 * MINUTE, [], true),
  ];
  const [
    self, aliceChat, bobChat, carolChat, daveChat, group, requestGroup, , eveChat, lindaChat, bookClub, oldProject,
  ] = conversations;
  await store.setItem('invitedNumbers', { [demoPni]: '+15550100077' });
  await store.setItem('demoDevices', [
    { id: 1, name: 'Pixel 9', lastSeen: now - 2 * 24 * 60 * MINUTE },
    { id: 2, name: 'TeleSignal (demo)', lastSeen: now },
    { id: 3, name: 'Signal Desktop', lastSeen: now - 5 * 24 * 60 * MINUTE },
  ]);

  const messages: [ConversationRecord, DemoMessage][] = [
    [aliceChat, {
      authorAci: alice, sentAt: now - 90 * MINUTE, isOutgoing: false, readAt: now - 80 * MINUTE,
      dataMessage: { body: 'Hi! Are we still on for Saturday?' },
    }],
    [aliceChat, {
      authorAci: me,
      sentAt: now - 85 * MINUTE,
      isOutgoing: true,
      readAt: now - 85 * MINUTE,
      recipientStatus: { [alice]: 'read' },
      reactions: [{ emoji: '❤️', authorAci: alice, sentAt: now - 84 * MINUTE }],
      dataMessage: {
        body: 'Yes! 10am at the station',
        bodyRanges: [{ start: 5, length: 4, associatedValue: { case: 'style', value: BodyRange_Style.BOLD } }],
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 80 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      dataMessage: {
        body: 'Perfect, I will bring snacks',
        quote: { id: BigInt(now - 85 * MINUTE), authorAci: me, text: 'Yes! 10am at the station' },
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 75 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      editedAt: now - 74 * MINUTE,
      revisions: [{
        dataMessage: toBinary(DataMessageSchema, create(DataMessageSchema, { body: 'Bring a jaket' })),
        editedAt: now - 75 * MINUTE,
      }],
      dataMessage: { body: 'Bring a jacket, it may rain' },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 73 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      deletedAt: now - 72 * MINUTE,
    }],
    [aliceChat, {
      kind: 'verifiedChange', authorAci: '', actorAci: alice, sentAt: now - 65 * MINUTE, isOutgoing: false, readAt: now,
      isVerified: true,
    }],
    [aliceChat, {
      kind: 'timerUpdate', authorAci: '', actorAci: me, sentAt: now - 60 * MINUTE, isOutgoing: true, readAt: now,
      expireTimer: 7 * 24 * 60 * 60,
    }],
    [aliceChat, {
      authorAci: me,
      sentAt: now - 50 * MINUTE,
      isOutgoing: true,
      readAt: now - 50 * MINUTE,
      recipientStatus: { [alice]: 'delivered' },
      expireTimer: 7 * 24 * 60 * 60,
      expiresAt: now + 7 * 24 * 60 * MINUTE,
      dataMessage: {
        body: 'Map of the trail',
        expireTimer: 7 * 24 * 60 * 60,
        attachments: [trailPhoto],
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 45 * MINUTE,
      isOutgoing: false,
      readAt: now - 44 * MINUTE,
      dataMessage: { isViewOnce: true, attachments: [viewOncePhoto] },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 40 * MINUTE,
      isOutgoing: false,
      readAt: now - 39 * MINUTE,
      dataMessage: { body: 'Photos from our last trip', attachments: albumPhotos },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 38 * MINUTE,
      isOutgoing: false,
      readAt: now - 37 * MINUTE,
      ...sticker,
    }],
    // Gift badges and payments, which only show as notices
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 36 * MINUTE,
      isOutgoing: false,
      readAt: now - 35 * MINUTE,
      dataMessage: { giftBadge: { receiptCredentialPresentation: new Uint8Array([1]) } },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 35 * MINUTE,
      isOutgoing: false,
      readAt: now - 34 * MINUTE,
      dataMessage: { payment: { Item: { case: 'notification', value: { note: 'Dinner' } } } },
    }],
    [aliceChat, {
      authorAci: me,
      sentAt: now - 34 * MINUTE,
      isOutgoing: true,
      readAt: now - 34 * MINUTE,
      recipientStatus: { [alice]: 'delivered' },
      dataMessage: { giftBadge: { receiptCredentialPresentation: new Uint8Array([2]) } },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 33 * MINUTE,
      isOutgoing: false,
      readAt: now - 32 * MINUTE,
      dataMessage: {
        payment: { Item: { case: 'activation', value: { type: DataMessage_Payment_Activation_Type.REQUEST } } },
      },
    }],
    [bobChat, {
      authorAci: me, sentAt: now - 300 * MINUTE, isOutgoing: true, readAt: now, recipientStatus: { [bob]: 'sent' },
      dataMessage: { body: 'Found you by username 👋' },
    }],
    [bobChat, {
      kind: 'safetyNumberChange',
      authorAci: '',
      actorAci: bob,
      sentAt: now - 295 * MINUTE,
      isOutgoing: false,
      readAt: now,
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 295 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: {
        contact: [{
          name: { givenName: 'Alice', familyName: 'Johnson' },
          number: [{ value: '+15550100001', type: DataMessage_Contact_Phone_Type.MOBILE }],
        }],
      },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 294 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: {
        contact: [{
          name: { givenName: 'Grace', familyName: 'Hopper' },
          number: [{ value: '+15550109999', type: DataMessage_Contact_Phone_Type.HOME }],
          email: [{ value: 'grace@example.com' }],
          organization: 'Navy',
        }],
      },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 290 * MINUTE,
      isOutgoing: false,
      readAt: now,
      unavailableAttachmentIndexes: [0],
      dataMessage: { body: 'Hey! Sending the report', attachments: [{
        attachmentIdentifier: { case: 'cdnKey', value: 'demo-file' },
        cdnNumber: 3,
        contentType: 'application/pdf',
        key: getRandomBytes(64),
        size: 1_200_000,
        fileName: 'report.pdf',
      }] },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 289 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: { attachments: [voiceNote] },
    }],
    [bobChat, {
      authorAci: bob, sentAt: now - 288 * MINUTE, isOutgoing: false, readAt: now, dataMessage: { attachments: [tune] },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 287 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: { body: 'The guide, as promised', attachments: [guide] },
    }],
    ...(video ? [[bobChat, {
      authorAci: bob, sentAt: now - 286 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'Clip from the hike', attachments: [video] },
    }] satisfies [ConversationRecord, DemoMessage]] : []),
    ...(gif ? [[bobChat, {
      authorAci: bob, sentAt: now - 285 * MINUTE, isOutgoing: false, readAt: now, dataMessage: { attachments: [gif] },
    }] satisfies [ConversationRecord, DemoMessage]] : []),
    [carolChat, {
      authorAci: carol, sentAt: now - 20 * MINUTE, isOutgoing: false, dataMessage: { body: 'Did you see the photos?' },
    }],
    [carolChat, {
      authorAci: carol,
      sentAt: now - 19 * MINUTE,
      isOutgoing: false,
      dataMessage: {
        body: 'Trail guide: https://en.wikipedia.org/wiki/Hiking',
        preview: [{
          url: 'https://en.wikipedia.org/wiki/Hiking',
          title: 'Hiking - Wikipedia',
          description: 'Hiking is a long, vigorous walk, usually on trails or footpaths in the countryside',
          image: previewPhoto,
          date: BigInt(now - 3 * 24 * 60 * MINUTE),
        }],
      },
    }],
    [carolChat, {
      authorAci: carol, sentAt: now - 18 * MINUTE, isOutgoing: false, dataMessage: { body: 'Call me when you can' },
    }],
    [daveChat, {
      authorAci: dave,
      sentAt: now - 10 * MINUTE,
      isOutgoing: false,
      dataMessage: { body: 'Hi, we met at the conference' },
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'create' },
      sentAt: now - 50 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'membersAdded', acis: [me, bob] },
      sentAt: now - 49 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'inviteLink', state: 'onWithApproval' },
      sentAt: now - 48 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: carol, groupUpdate: { type: 'joinRequested' },
      sentAt: now - 47 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'joinApproved', aci: carol },
      sentAt: now - 46 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: me, groupUpdate: { type: 'description' },
      sentAt: now - 45 * MINUTE, isOutgoing: true, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate',
      authorAci: '',
      actorAci: alice,
      groupUpdate: { type: 'adminChanged', aci: bob, isAdmin: true },
      sentAt: now - 44 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate',
      authorAci: '',
      actorAci: alice,
      groupUpdate: { type: 'access', target: 'info', isAdminOnly: true },
      sentAt: now - 43 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'invited', count: 2 },
      sentAt: now - 42 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      authorAci: alice, sentAt: now - 40 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'Plan for Saturday: hike, then picnic by the lake' },
    }],
    [group, {
      authorAci: bob, sentAt: now - 35 * MINUTE, isOutgoing: false, readAt: now,
      reactions: [{ emoji: '👍', authorAci: alice, sentAt: now - 34 * MINUTE }],
      dataMessage: {
        body: '@Demo can you book the tables?',
        bodyRanges: [{ start: 0, length: 5, associatedValue: { case: 'mentionAci', value: me } }],
      },
    }],
    [group, {
      authorAci: bob,
      sentAt: now - 33 * MINUTE,
      isOutgoing: false,
      readAt: now,
      deletedAt: now - 32 * MINUTE,
      deletedByAdminAci: alice,
    }],
    [group, {
      authorAci: me, sentAt: now - 30 * MINUTE, isOutgoing: true, readAt: now,
      recipientStatus: { [alice]: 'read', [bob]: 'delivered', [carol]: 'sent' },
      dataMessage: { body: 'Booked for 2pm' },
    }],
    [group, {
      authorAci: me, sentAt: now - 29 * MINUTE, isOutgoing: true, readAt: now,
      recipientStatus: { [alice]: 'delivered', [bob]: 'sent', [carol]: 'failed' },
      recipientErrors: { [carol]: 'unregistered' },
      dataMessage: { body: 'Carol deleted her account, so the message still looks sent' },
    }],
    [group, {
      authorAci: me, sentAt: now - 28 * MINUTE, isOutgoing: true, readAt: now,
      recipientStatus: { [alice]: 'read', [bob]: 'failed', [carol]: 'sent' },
      recipientErrors: { [bob]: 'network' },
      dataMessage: { body: 'Dinner at 8, who is in? Bob did not get this one' },
    }],
    [group, {
      authorAci: me, sentAt: now - 27 * MINUTE, isOutgoing: true, readAt: now,
      recipientStatus: { [alice]: 'failed', [bob]: 'failed', [carol]: 'failed' },
      recipientErrors: { [alice]: 'rateLimited', [bob]: 'rateLimited', [carol]: 'identityChanged' },
      dataMessage: { body: 'Nobody got this message' },
    }],
    [group, {
      authorAci: alice,
      sentAt: now - 25 * MINUTE,
      isOutgoing: false,
      readAt: now,
      pollVotes: [
        { authorAci: alice, optionIndexes: [0], voteCount: 1 },
        { authorAci: bob, optionIndexes: [1], voteCount: 1 },
        { authorAci: me, optionIndexes: [0], voteCount: 1 },
      ],
      dataMessage: { pollCreate: { question: 'What should we bring?', options: ['Sandwiches', 'Pizza', 'Fruit'] } },
    }],
    [group, {
      authorAci: carol, sentAt: now - 5 * MINUTE, isOutgoing: false, dataMessage: { body: 'Count me in!' },
    }],
    [bookClub, {
      authorAci: bob,
      sentAt: now - 20 * MINUTE,
      isOutgoing: false,
      dataMessage: { body: 'I found a new poetry collection' },
    }],
    [bookClub, {
      authorAci: carol, sentAt: now - 19 * MINUTE, isOutgoing: false, dataMessage: { body: 'I will bring the cookies' },
    }],
    [bookClub, {
      kind: 'groupUpdate',
      authorAci: '',
      actorAci: me,
      groupUpdate: { type: 'access', target: 'memberLabel', isAdminOnly: false },
      sentAt: now - 18 * MINUTE, isOutgoing: true, readAt: now,
    }],
    [bookClub, {
      kind: 'groupUpdate', authorAci: '', actorAci: me, groupUpdate: { type: 'invited', count: 2 },
      sentAt: now - 17 * MINUTE, isOutgoing: true, readAt: now,
    }],
    [oldProject, {
      authorAci: alice,
      sentAt: now - 60 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: { body: 'Shipping on Friday' },
    }],
    [oldProject, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'terminated' },
      sentAt: now - 50 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [requestGroup, {
      authorAci: frank, sentAt: now - 3 * MINUTE, isOutgoing: false,
      dataMessage: { body: 'Double your coins today, limited offer!' },
    }],
    [eveChat, {
      authorAci: eve, sentAt: now - 600 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'You won a prize' },
    }],
  ];

  // One link of each kind, to try how the app opens them
  messages.push(...buildLinkMessages(lindaChat, linda, now));

  const lastByConversation = new Map<string, { id: number; sentAt: number }>();
  for (const [conversation, { dataMessage, kind = 'message', ...record }] of messages) {
    const message = await db.addMessage({
      ...record,
      conversationId: conversation.id,
      kind,
      receivedAt: record.sentAt,
      body: dataMessage?.body || undefined,
      dataMessage: dataMessage && !record.deletedAt
        ? toBinary(DataMessageSchema, create(DataMessageSchema, { ...dataMessage, timestamp: BigInt(record.sentAt) }))
        : undefined,
    });
    lastByConversation.set(conversation.id, { id: message.id, sentAt: message.sentAt });
  }

  // Chat colors and wallpapers from the transferred history; Bob's chat uses the default style of the account
  aliceChat.chatStyle = {
    wallpaperPreset: ChatStyle_WallpaperPreset.GRADIENT_AQUA,
    bubbleColorPreset: ChatStyle_BubbleColorPreset.GRADIENT_LAGOON,
  };
  carolChat.chatStyle = { wallpaperPreset: ChatStyle_WallpaperPreset.SOLID_BLUSH };

  // Calls of the call history, which show in their chats and the call log
  const demoCalls: [ConversationRecord, Omit<CallRecord, 'peerId' | 'messageId' | 'mode'>][] = [
    [aliceChat, {
      callId: '1001', type: 'audio', direction: 'incoming', status: 'accepted', timestamp: now - 500 * MINUTE,
    }],
    [bobChat, {
      callId: '1002', type: 'audio', direction: 'outgoing', status: 'missed', timestamp: now - 290 * MINUTE,
    }],
    [group, {
      callId: '1003', type: 'group', direction: 'incoming', status: 'joined', timestamp: now - 200 * MINUTE,
    }],
    [bobChat, {
      callId: '1004', type: 'video', direction: 'incoming', status: 'declined', timestamp: now - 100 * MINUTE,
    }],
    [aliceChat, {
      callId: '1005', type: 'video', direction: 'incoming', status: 'missed', timestamp: now - 22 * MINUTE,
      isUnseen: true,
    }],
    [group, {
      callId: '1006', type: 'group', direction: 'incoming', status: 'genericGroupCall', timestamp: now - 2 * MINUTE,
      isUnseen: true,
    }],
  ];
  for (const [conversation, call] of demoCalls) {
    const message = await db.addMessage({
      conversationId: conversation.id,
      kind: 'call',
      authorAci: '',
      callId: call.callId,
      sentAt: call.timestamp,
      receivedAt: call.timestamp,
      isOutgoing: call.direction === 'outgoing',
    });
    await db.putCall({
      ...call, peerId: conversation.id, mode: call.type === 'group' ? 'group' : 'direct', messageId: message.id,
    });
    lastByConversation.set(conversation.id, { id: message.id, sentAt: message.sentAt });
  }

  // Notification profiles: one on a schedule, and one turned on by hand for a while
  const workProfileId = bufferToHex(getRandomBytes(DEMO_PROFILE_ID_LENGTH));
  const sleepProfileId = bufferToHex(getRandomBytes(DEMO_PROFILE_ID_LENGTH));
  await store.setItem('notificationProfiles', [
    {
      id: workProfileId,
      name: 'Work',
      emoji: '💼',
      color: DEFAULT_PROFILE_COLOR,
      createdAt: now - 20 * MINUTE,
      areAllCallsAllowed: false,
      areAllMentionsAllowed: true,
      allowedConversationIds: [alice, group.id],
      isScheduleEnabled: true,
      scheduleStartTime: 900,
      scheduleEndTime: 1700,
      scheduleDays: [1, 2, 3, 4, 5],
    },
    {
      id: sleepProfileId,
      name: 'Sleep',
      emoji: '😴',
      color: DEFAULT_PROFILE_COLOR,
      createdAt: now - 10 * MINUTE,
      areAllCallsAllowed: false,
      areAllMentionsAllowed: false,
      allowedConversationIds: [bob],
      isScheduleEnabled: true,
      scheduleStartTime: 2200,
      scheduleEndTime: 700,
      scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    },
  ]);
  await store.setItem('notificationProfileOverride', {
    enabled: { profileId: sleepProfileId, endsAt: now + 90 * MINUTE },
  });

  for (const conversation of conversations) {
    const last = lastByConversation.get(conversation.id);
    await db.putConversation({ ...conversation, lastMessageId: last?.id, lastMessageAt: last?.sentAt });
  }

  const ownStoryAt = now - 120 * MINUTE;
  const stories: [ConversationRecord, DemoStory][] = [
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 180 * MINUTE,
      isOutgoing: false,
      viewedAt: now - 170 * MINUTE,
      storyMessage: {
        allowsReplies: true,
        attachment: {
          case: 'textAttachment', value: createTextAttachment('Coffee first ☕', 0, TextAttachment_Style.BOLD),
        },
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 25 * MINUTE,
      isOutgoing: false,
      storyMessage: {
        allowsReplies: true,
        attachment: { case: 'fileAttachment', value: { ...mountainsPhoto, caption: 'Trail check for Saturday' } },
        bodyRanges: [{ start: 0, length: 11, associatedValue: { case: 'style', value: BodyRange_Style.BOLD } }],
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 15 * MINUTE,
      isOutgoing: false,
      storyMessage: {
        allowsReplies: true,
        attachment: {
          case: 'textAttachment',
          value: createTextAttachment('Who is in for the 10 km loop? 🥾', 5, TextAttachment_Style.SERIF),
        },
      },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 40 * MINUTE,
      isOutgoing: false,
      storyMessage: {
        allowsReplies: false,
        attachment: {
          case: 'textAttachment', value: createTextAttachment('New bike day!', 6, TextAttachment_Style.SCRIPT),
        },
      },
    }],
    [group, {
      authorAci: carol,
      sentAt: now - 30 * MINUTE,
      isOutgoing: false,
      replies: [{ authorAci: alice, sentAt: now - 28 * MINUTE, body: 'So pretty!' }],
      storyMessage: {
        allowsReplies: true,
        group: { masterKey: group.masterKey, revision: group.revision },
        attachment: { case: 'fileAttachment', value: { ...lakePhoto, caption: 'Picnic spot by the lake' } },
      },
    }],
    [self, {
      authorAci: me,
      sentAt: ownStoryAt,
      isOutgoing: true,
      viewedAt: ownStoryAt,
      recipients: {
        [alice]: {
          status: 'viewed', isAllowedToReply: true, distributionListIds: [MY_STORY_ID], viewedAt: now - 110 * MINUTE,
        },
        [bob]: {
          status: 'viewed', isAllowedToReply: true, distributionListIds: [MY_STORY_ID], viewedAt: now - 90 * MINUTE,
        },
        [carol]: { status: 'delivered', isAllowedToReply: true, distributionListIds: [MY_STORY_ID] },
      },
      replies: [
        { authorAci: alice, sentAt: now - 108 * MINUTE, body: 'Where is this?' },
        { authorAci: bob, sentAt: now - 89 * MINUTE, emoji: '❤️' },
      ],
      storyMessage: {
        allowsReplies: true,
        attachment: {
          case: 'textAttachment',
          value: createTextAttachment('Packed and ready for the weekend', 7, TextAttachment_Style.DEFAULT),
        },
      },
    }],
  ];
  for (const [conversation, { storyMessage, ...record }] of stories) {
    await db.addStory({
      ...record,
      conversationId: conversation.id,
      receivedAt: record.sentAt,
      expiresAt: record.sentAt + STORY_LIFETIME_MS,
      storyMessage: toBinary(StoryMessageSchema, create(StoryMessageSchema, storyMessage)),
    });
  }
}

function buildDemoGroup(
  localId: number,
  title: string,
  selfAci: string,
  members: GroupMember[],
  invitedAt: number,
  pendingMembers: { serviceId: string; addedBy: string }[],
  isTerminated?: boolean,
): ConversationRecord {
  const state: GroupState = {
    revision: 5,
    title,
    accessControl: buildAccessControl(),
    members,
    pendingMembers: pendingMembers.map((member) => ({ ...member, timestamp: invitedAt })),
    requestingMembers: [],
    bannedMembers: [],
    isTerminated,
  };
  return {
    id: btoa(String.fromCharCode(...getRandomBytes(32))),
    localId,
    type: 'group',
    masterKey: getRandomBytes(32),
    revision: state.revision,
    title,
    memberAcis: members.map(({ aci }) => aci),
    adminAcis: members.filter(({ role }) => role === Member_Role.ADMINISTRATOR).map(({ aci }) => aci),
    groupState: state,
    unreadCount: 0,
    isAccepted: true,
  };
}

function createTextAttachment(text: string, backgroundIndex: number, textStyle: TextAttachment_Style) {
  const background = STORY_BACKGROUNDS[backgroundIndex];
  return {
    text,
    textStyle,
    background: 'color' in background
      ? { case: 'color' as const, value: background.color }
      : { case: 'gradient' as const, value: background },
  };
}

/** Messages with the links that Signal's apps share, and some that only look like them */
function buildLinkMessages(conversation: ConversationRecord, authorAci: string, now: number): [
  ConversationRecord, DemoMessage,
][] {
  const { id, key } = getKnownStickerPacks()[DEMO_STICKER_PACK_INDEX];
  const links = [
    `Username: https://signal.me/#eu/${bufferToBase64Url(getRandomBytes(DEMO_USERNAME_LINK_LENGTH))}`,
    'Phone number: https://signal.me/#p/+15550100001',
    `Group: ${buildGroupInviteLink(getRandomBytes(DEMO_KEY_LENGTH), getRandomBytes(DEMO_PASSWORD_LENGTH))}`,
    `Sticker pack: ${buildStickerPackLink(id, key)}`,
    'Signal proxy: https://signal.tube/#proxy.example.org',
    'Call: https://signal.link/call/#key=bcdf-ghkm-npqr-stxz-bcdf-ghkm-npqr-stxz',
    'In the app scheme: sgnl://signal.me/#p/+15550100001',
    'Artist series: https://signal.art/',
    'Donate: https://signaldonations.org/',
    'Look-alike host: https://signal.me.example.com/#p/+15550100001',
  ];
  return links.map((body, index) => [conversation, {
    authorAci,
    sentAt: now - (links.length - index) * MINUTE,
    isOutgoing: false,
    readAt: now,
    dataMessage: { body },
  }]);
}

/**
 * A sticker drawn here and cached as its attachment, so it shows without a connection. It names a pack of Signal's
 * artist series, which opens from the sticker.
 */
async function createDemoSticker(): Promise<Pick<DemoMessage, 'dataMessage'>> {
  const { id, key } = getKnownStickerPacks()[DEMO_STICKER_PACK_INDEX];
  const canvas = new OffscreenCanvas(STICKER_SIZE, STICKER_SIZE);
  drawSmiley(canvas.getContext('2d')!);
  const blob = await canvas.convertToBlob({ type: STICKER_MIME_TYPE });
  const data = create(AttachmentPointerSchema, {
    attachmentIdentifier: { case: 'cdnKey', value: 'demo-sticker' },
    cdnNumber: 3,
    contentType: blob.type,
    key: getRandomBytes(64),
    size: blob.size,
    width: STICKER_SIZE,
    height: STICKER_SIZE,
  });
  await saveAttachmentBlob(data, blob);
  return {
    dataMessage: {
      sticker: {
        packId: bufferFromHex(id), packKey: bufferFromHex(key), stickerId: DEMO_STICKER_ID, emoji: '😊', data,
      },
    },
  };
}

/** A photo attachment whose bytes are cached, so it shows without a download */
async function createDemoPhoto(
  cdnKey: string,
  draw: (context: OffscreenCanvasRenderingContext2D, width: number, height: number) => void,
  width = PHOTO_WIDTH,
  height = PHOTO_HEIGHT,
) {
  const canvas = new OffscreenCanvas(width, height);
  draw(canvas.getContext('2d')!, width, height);
  return createDemoAttachment(cdnKey, await canvas.convertToBlob({ type: PHOTO_MIME_TYPE }), { width, height });
}

/** An attachment whose bytes are cached, so it shows without a download */
async function createDemoAttachment(
  cdnKey: string, blob: Blob, fields: MessageInitShape<typeof AttachmentPointerSchema> = {},
) {
  const pointer = create(AttachmentPointerSchema, {
    attachmentIdentifier: { case: 'cdnKey', value: cdnKey },
    cdnNumber: 3,
    contentType: blob.type,
    key: getRandomBytes(64),
    size: blob.size,
    ...fields,
  });
  await saveAttachmentBlob(pointer, blob);
  return pointer;
}

/** A voice note of a hum that rises and falls in syllables, with its waveform */
function createDemoVoiceNote() {
  const samples = new Float32Array(VOICE_DURATION_S * AUDIO_SAMPLE_RATE).map((_, i) => {
    const time = i / AUDIO_SAMPLE_RATE;
    const envelope = Math.abs(Math.sin(Math.PI * VOICE_SYLLABLE_RATE * time));
    return envelope * Math.sin(2 * Math.PI * VOICE_FREQUENCY * time);
  });
  const chunkLength = Math.floor(samples.length / WAVEFORM_LENGTH);
  const waveform = Uint8Array.from({ length: WAVEFORM_LENGTH }, (_, i) => (
    Math.round(0xff * Math.max(...samples.subarray(i * chunkLength, (i + 1) * chunkLength).map(Math.abs)))
  ));
  return createDemoAttachment('demo-voice', createWav(samples), {
    flags: AttachmentPointer_Flags.VOICE_MESSAGE, audioDurationSeconds: VOICE_DURATION_S, audioWaveform: waveform,
  });
}

/** A major scale, one note after another */
function createTuneSamples() {
  const noteLength = TUNE_NOTE_DURATION_S * AUDIO_SAMPLE_RATE;
  return new Float32Array(TUNE_NOTES.length * noteLength).map((_, i) => {
    const frequency = TUNE_NOTES[Math.floor(i / noteLength)];
    const decay = 1 - (i % noteLength) / noteLength;
    return decay * Math.sin((2 * Math.PI * frequency * i) / AUDIO_SAMPLE_RATE);
  });
}

/** Samples from -1 to 1 as a WAV file */
function createWav(samples: Float32Array) {
  const dataLength = samples.length * AUDIO_BYTES_PER_SAMPLE;
  const view = new DataView(new ArrayBuffer(WAV_HEADER_LENGTH + dataLength));
  const writeText = (offset: number, text: string) => {
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  };
  // The RIFF header and the format chunk of PCM audio, at their fixed offsets
  writeText(0, 'RIFF');
  view.setUint32(4, WAV_HEADER_LENGTH - 8 + dataLength, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_SAMPLE_RATE * AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(32, AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 8 * AUDIO_BYTES_PER_SAMPLE, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);
  samples.forEach((sample, i) => {
    view.setInt16(WAV_HEADER_LENGTH + i * AUDIO_BYTES_PER_SAMPLE, Math.round(sample * AUDIO_AMPLITUDE), true);
  });
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** A one-page PDF with a line of text */
function createPdf(text: string) {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R '
    + '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}

/**
 * A short MP4 of a ball crossing the frame, recorded from a canvas; `undefined` where the browser cannot record MP4,
 * since Signal sends no other video type
 */
async function createDemoVideo(
  cdnKey: string, width: number, height: number, fields: MessageInitShape<typeof AttachmentPointerSchema>,
) {
  if (!MediaRecorder.isTypeSupported(VIDEO_MIME_TYPE)) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const recorder = new MediaRecorder(canvas.captureStream(VIDEO_FPS), { mimeType: VIDEO_MIME_TYPE });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  const startedAt = performance.now();
  // A timer rather than animation frames, which a background tab does not get; it only runs slower there
  const drawFrame = () => {
    const progress = Math.min((performance.now() - startedAt) / VIDEO_DURATION_MS, 1);
    drawSunset(context, width, height);
    context.fillStyle = '#c0392b';
    context.beginPath();
    context.arc(progress * width, height / 2, VIDEO_BALL_RADIUS, 0, 2 * Math.PI);
    context.fill();
    if (progress < 1) return;

    clearInterval(timer);
    recorder.stop();
  };
  drawFrame();
  recorder.start();
  const timer = setInterval(drawFrame, MS_PER_SECOND / VIDEO_FPS);
  await stopped;

  const blob = new Blob(chunks, { type: VIDEO_MIME_TYPE });
  return createDemoAttachment(cdnKey, blob, { width, height, ...fields });
}

function drawTrailMap(context: OffscreenCanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  gradient.addColorStop(0, '#a8d5a2');
  gradient.addColorStop(1, '#4f8f5b');
  context.fillStyle = gradient;
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

  context.strokeStyle = '#c0392b';
  context.lineWidth = TRAIL_WIDTH;
  context.lineCap = 'round';
  context.beginPath();
  TRAIL_POINTS.forEach(([x, y]) => context.lineTo(x * PHOTO_WIDTH, y * PHOTO_HEIGHT));
  context.stroke();
}

function drawSmiley(context: OffscreenCanvasRenderingContext2D) {
  const center = STICKER_SIZE / 2;
  context.fillStyle = '#ffd56b';
  context.beginPath();
  context.arc(center, center, SMILEY_RADIUS, 0, 2 * Math.PI);
  context.fill();
  context.fillStyle = '#3b2f2f';
  for (const eyeX of [center - SMILEY_EYE_OFFSET, center + SMILEY_EYE_OFFSET]) {
    context.beginPath();
    context.arc(eyeX, center - SMILEY_EYE_OFFSET, SMILEY_EYE_RADIUS, 0, 2 * Math.PI);
    context.fill();
  }
  context.strokeStyle = '#3b2f2f';
  context.lineWidth = TRAIL_WIDTH;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(center, center, SMILEY_MOUTH_RADIUS, 0.2 * Math.PI, 0.8 * Math.PI);
  context.stroke();
}

function drawLake(context: OffscreenCanvasRenderingContext2D) {
  context.fillStyle = '#9fd3f0';
  context.fillRect(0, 0, PHOTO_WIDTH, LAKE_TOP);
  context.fillStyle = '#2e7fb8';
  context.fillRect(0, LAKE_TOP, PHOTO_WIDTH, PHOTO_HEIGHT - LAKE_TOP);
}

function drawSunset(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#2c3e70');
  gradient.addColorStop(1, '#f39c4a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#ffd56b';
  context.beginPath();
  context.arc(width / 2, (SUN_CENTER_Y / PHOTO_HEIGHT) * height, SUN_RADIUS, 0, 2 * Math.PI);
  context.fill();
}

function drawMountains(context: OffscreenCanvasRenderingContext2D, width: number, height: number) {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#7ec8f2');
  sky.addColorStop(1, '#e8f4fb');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#3d6b4f';
  context.beginPath();
  context.moveTo(0, height);
  PEAKS.forEach(([x, y]) => context.lineTo(x * width, y * height));
  context.lineTo(width, height);
  context.fill();
}

function generateKeyPair() {
  const privateKey = wasm.PrivateKey_Generate();
  return {
    privateKey: wasm.PrivateKey_Serialize(privateKey),
    publicKey: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(privateKey)),
  };
}
