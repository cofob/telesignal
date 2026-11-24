import {LangPackKey} from '@lib/langPack';
import Button from '@components/buttonTsx';

export const MoreButton = (props: {
  count: number,
  callback: Parameters<typeof Button>[0]['onClick'],
  key?: LangPackKey
}) => {
  return (
    <Button
      text={props.key || 'PollResults.LoadMore'}
      textArgs={[props.count]}
      onClick={(e) => props.callback(e)}
      class="btn btn-primary btn-transparent primary"
      icon="down"
    />
  );
};
