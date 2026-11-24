/*
 * TeleSignal: Signal polls in Web K's shapes. The provider builds a poll with each message that has one (its id is the
 * message's) and sends it again as votes come; the adapter keeps the latest of each here, so a built message carries
 * its poll. A Signal poll option is its index, which Web K holds as the bytes of its text.
 */

import type {InputMedia, MessageEntity, MessageMedia, MethodDeclMap, Poll, PollResults, Update, Updates} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, toSignalPeerId} from '@lib/signal/builders';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

type SignalFormattedText = {text: string};
export type SignalPoll = {
  summary: {
    id: string,
    isClosed?: boolean,
    isPublic?: boolean,
    isMultipleChoice?: boolean,
    isCreator?: boolean,
    question: SignalFormattedText,
    answers: {text: SignalFormattedText, option: string}[]
  },
  results: {
    resultByOption?: Record<string, {option: string, votersCount: number, isChosen?: boolean}>,
    totalVoters?: number,
    recentVoterIds?: string[]
  }
};

const pollsById = new Map<string, SignalPoll>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Keeps the latest version of polls that came with messages or entities */
export function rememberPolls(polls: SignalPoll[] | undefined) {
  polls?.forEach((poll) => pollsById.set(poll.summary.id, poll));
}

export function buildPollMedia(pollId: string): MessageMedia.messageMediaPoll | undefined {
  const poll = pollsById.get(pollId);
  return poll && {_: 'messageMediaPoll', poll: buildPoll(poll), results: buildPollResults(poll)};
}

/** The results of a poll for Web K, which takes them from this update after a vote */
export function buildPollUpdate(poll: SignalPoll): Update.updateMessagePoll {
  return {_: 'updateMessagePoll', poll_id: poll.summary.id, poll: buildPoll(poll), results: buildPollResults(poll)};
}

export function buildPollHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.sendVote': (params: MethodDeclMap['messages.sendVote']['req']) => sendVote(host, params),
    'messages.getPollResults': (params: MethodDeclMap['messages.getPollResults']['req']) => getPollResults(params),
    'messages.getPollVotes': (params: MethodDeclMap['messages.getPollVotes']['req']) => getPollVotes(host, params)
  };
}

/** Ends a poll when Web K edits it to a closed one; `false` for any other edit */
export async function closePollByEdit(host: SignalMethodHost, params: MethodDeclMap['messages.editMessage']['req']) {
  const media = params.media;
  if(media?._ !== 'inputMediaPoll' || !media.poll.pFlags.closed) return false;
  const peerId = host.getInputPeerId(params.peer);
  await host.call('closePoll', {chat: {id: toSignalPeerId(peerId)}, messageId: params.id});
  return true;
}

function buildPoll({summary}: SignalPoll): Poll.poll {
  return {
    _: 'poll',
    id: summary.id,
    pFlags: {
      closed: summary.isClosed || undefined,
      public_voters: summary.isPublic || undefined,
      multiple_choice: summary.isMultipleChoice || undefined,
      creator: summary.isCreator || undefined
    },
    question: {_: 'textWithEntities', text: summary.question.text, entities: [] as MessageEntity[]},
    answers: summary.answers.map(({text, option}) => ({
      _: 'pollAnswer',
      text: {_: 'textWithEntities', text: text.text, entities: [] as MessageEntity[]},
      option: encoder.encode(option)
    })),
    hash: 0
  };
}

function buildPollResults({summary, results}: SignalPoll): PollResults.pollResults {
  return {
    _: 'pollResults',
    pFlags: {},
    results: summary.answers.map(({option}) => {
      const result = results.resultByOption?.[option];
      return {
        _: 'pollAnswerVoters',
        pFlags: {chosen: result?.isChosen || undefined},
        option: encoder.encode(option),
        voters: result?.votersCount ?? 0
      };
    }),
    total_voters: results.totalVoters ?? 0,
    recent_voters: (results.recentVoterIds ?? []).map((id) => buildPeer(id))
  };
}

async function sendVote(host: SignalMethodHost, params: MethodDeclMap['messages.sendVote']['req']) {
  const peerId = host.getInputPeerId(params.peer);
  if(!peerId) throw makeError('PEER_ID_INVALID' as ErrorType);
  // * the vote comes back with its poll as the message changes
  await host.call('sendPollVote', {
    chat: {id: toSignalPeerId(peerId)},
    messageId: params.msg_id,
    options: params.options.map((option) => decoder.decode(option))
  });
  return buildUpdates([]);
}

function getPollResults(params: MethodDeclMap['messages.getPollResults']['req']) {
  const poll = pollsById.get(String(params.msg_id));
  return buildUpdates(poll ? [buildPollUpdate(poll)] : []);
}

/** Who voted for an option, or for each option of the poll without one; Signal votes carry no date */
async function getPollVotes(host: SignalMethodHost, params: MethodDeclMap['messages.getPollVotes']['req']) {
  const peerId = host.getInputPeerId(params.peer);
  const options = params.option ?
    [params.option] :
    (pollsById.get(String(params.id))?.summary.answers ?? []).map(({option}) => encoder.encode(option));
  const votes = (await Promise.all(options.map(async(option) => {
    const result: {votes: {peerId: string}[]} | undefined = await host.call('loadPollOptionResults', {
      chat: {id: toSignalPeerId(peerId)},
      messageId: params.id,
      option: decoder.decode(option)
    });
    return (result?.votes ?? []).map(({peerId: voterId}) => ({
      _: 'messagePeerVote',
      peer: buildPeer(voterId),
      option,
      date: 0
    }));
  }))).flat();
  return {
    _: 'messages.votesList',
    pFlags: {},
    count: votes.length,
    votes,
    chats: [],
    users: []
  } as MethodDeclMap['messages.getPollVotes']['res'];
}

function buildUpdates(updates: Update[]) {
  return {_: 'updates', updates, users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
}

/** The provider's new poll of Web K's `inputMediaPoll`: a question, its options in order and multiple choice */
export function buildOutgoingPoll({poll}: InputMedia.inputMediaPoll) {
  return {
    summary: {
      id: '',
      hash: '',
      isMultipleChoice: poll.pFlags.multiple_choice || undefined,
      question: {text: poll.question.text},
      answers: poll.answers.map((answer, index) => ({text: {text: answer.text.text}, option: String(index)}))
    }
  };
}
