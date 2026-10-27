/** Minimal public surface of the generated, unchanged ESM vendor bundle. */
export declare const XMLValidator: { validate(xml: string): true | { err: { code: string; msg: string; line: number; col: number } } };
export declare class Parser {
  startIndex: number;
  endIndex: number;
  constructor(handlers: {
    onopentag?: (name: string, attributes: Record<string, string>, implied: boolean) => void;
    onclosetag?: (name: string, implied: boolean) => void;
    onattribute?: (name: string, value: string, quote?: string | null) => void;
    ontext?: (data: string) => void;
    oncomment?: (data: string) => void;
    oncdatastart?: () => void;
    oncdataend?: () => void;
    onprocessinginstruction?: (name: string, data: string) => void;
    onerror?: (error: Error) => void;
  }, options?: { xmlMode?: boolean; decodeEntities?: boolean; lowerCaseTags?: boolean; lowerCaseAttributeNames?: boolean; recognizeCDATA?: boolean; recognizeSelfClosing?: boolean });
  end(input: string): void;
}
