import { task } from "@nomiclabs/buidler/config";
import { utils } from "ethers";
import { readArtifact } from "@nomiclabs/buidler/plugins";

export default task("abi-encode-withselector")
  .addPositionalParam("contractname")
  .addPositionalParam("functionname")
  .addOptionalVariadicPositionalParam("inputs")
  .addFlag("log")
  .setAction(async (taskArgs) => {
    try {
      if (taskArgs.log) console.log(taskArgs);

      const { abi } = await readArtifact(
        config.paths.artifacts,
        taskArgs.contractname
      );
      const interFace = new utils.Interface(abi);

      let payloadWithSelector;

      if (taskArgs.inputs) {
        let iterableInputs;
        try {
          iterableInputs = [...taskArgs.inputs];
        } catch (error) {
          iterableInputs = [taskArgs.inputs];
        }
        payloadWithSelector = interFace.functions[taskArgs.functionname].encode(
          iterableInputs
        );
      } else {
        payloadWithSelector = interFace.functions[taskArgs.functionname].encode(
          []
        );
      }

      if (taskArgs.log)
        console.log(`\nEncodedPayloadWithSelector:\n${payloadWithSelector}\n`);
      return payloadWithSelector;
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
