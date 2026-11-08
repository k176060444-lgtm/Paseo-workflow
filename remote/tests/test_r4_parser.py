import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p0_runner import final_json,parse_output

class R4RemoteParserTests(unittest.TestCase):
    def test_fail_then_pass_not_accepted(self):
        fail={'verdict':'FAIL','summary':'real issue','findings':['BLOCKER: source'] }
        passed={'verdict':'PASS','summary':'reference example','findings':[]}
        text='## audit\n'+json.dumps(fail)+'\n'+json.dumps(passed)
        self.assertIsNone(final_json(text))
        result=parse_output(text)
        self.assertEqual(result['verdict'],'QUESTION')

    def test_multiple_fenced_verdicts_fail_closed(self):
        fence=chr(96)*3
        example=json.dumps({'verdict':'PASS','summary':'example','findings':[]})
        real=json.dumps({'verdict':'FAIL','summary':'real','findings':['HIGH: defect']})
        text='Example\n'+fence+'json\n'+example+'\n'+fence+'\n'+fence+'json\n'+real+'\n'+fence
        self.assertIsNone(final_json(text))
        self.assertEqual(parse_output(text)['verdict'],'QUESTION')

    def test_single_pretty_or_indented_final_verdict(self):
        fail={'verdict':'FAIL','summary':'actual defects','findings':['HIGH: defect']}
        text='## report\r\n  '+json.dumps(fail,indent=2)
        self.assertEqual(parse_output(text)['verdict'],'FAIL')
        self.assertIsNone(final_json(text+'\ntrailing prose'))

    def test_regular_jsonl_with_one_extracted_report(self):
        report={'verdict':'PASS','summary':'checked','findings':[]}
        event={'type':'text','part':{'text':json.dumps(report)}}
        self.assertEqual(parse_output(json.dumps(event))['verdict'],'PASS')

if __name__=='__main__':
    unittest.main()
