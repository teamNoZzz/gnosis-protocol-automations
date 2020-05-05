import { internalTask } from "@nomiclabs/buidler/config";
import { Contract } from "ethers";
import { readArtifact } from "@nomiclabs/buidler/plugins";

export default internalTask(
  "instantiateContract",
  "Returns a --read or --write instance of --name on [--network]"
)
  .addParam("name")
  .addOptionalParam("address")
  .addOptionalParam(
    "signer",
    "The signer object (private key) that will be used to send tx to the contract"
  )
  .addFlag("read")
  .addFlag("write")
  .setAction(async ({ name, address, signer, read, write }) => {
    try {
      if (!read && !write)
        throw new Error("\ninstantiateContract: must specify read or write");

      const { abi } = await readArtifact(config.paths.artifacts, name);

      let instance;
      if (read) {
        instance = new Contract(address, abi, ethers.provider);
      } else if (write && signer) {
        instance = new Contract(address, abi, signer);
      }
      return instance;
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
