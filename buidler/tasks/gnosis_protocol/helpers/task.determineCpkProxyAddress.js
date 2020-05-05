import { task, types } from "@nomiclabs/buidler/config";
import { constants, utils } from "ethers";

export default task(
  "determineCpkProxyAddress",
  `Determines gnosis safe proxy address from cpk factory on rinkeby`
)
  .addOptionalPositionalParam(
    "useraddress",
    "address of EOA whose proxy to derive"
  )
  .addOptionalParam(
    "saltnonce",
    "saltnonce that takes part in deriving the address - default to global CPK nonce",
    "0xcfe33a586323e7325be6aa6ecd8b4600d232a9037e83c8ece69413b777dabe65"
  )

  .addFlag("log", "Logs return values to stdout")
  .setAction(async ({ useraddress, saltnonce, log }) => {
    try {
      const user = config.networks.rinkeby.user();

      if (!useraddress) useraddress = await user.getAddress();

      // Generate CPK Gnosis Safe Proxy address
      if (!saltnonce)
        saltnonce =
          "0xcfe33a586323e7325be6aa6ecd8b4600d232a9037e83c8ece69413b777dabe65";
      // const saltnonce = "0xcfe33a586323e7325be6aa6ecd8b4600d232a9037e83c8ece69413b777dabe65"
      // const proxyFactory = "0x336c19296d3989e9e0c2561ef21c964068657c38"

      const create2Salt = utils.keccak256(
        utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [useraddress, saltnonce]
        )
      );

      const proxyFactoryAddress =
        config.networks.rinkeby.addressBook.gnosisSafe.cpkFactory;

      const mastercopyAddress =
        config.networks.rinkeby.addressBook.gnosisSafe.mastercopy;

      const proxyFactoryContract = await run("instantiateContract", {
        name: "CPKFactory",
        address: proxyFactoryAddress,
        signer: user,
        read: true,
      });

      const proxyFactoryCreationCode = await proxyFactoryContract.proxyCreationCode();

      const gnosisSafeAddress = utils.getAddress(
        utils
          .solidityKeccak256(
            ["bytes", "address", "bytes32", "bytes32"],
            [
              "0xff",
              proxyFactoryAddress,
              create2Salt,
              utils.solidityKeccak256(
                ["bytes", "bytes"],
                [
                  proxyFactoryCreationCode,
                  utils.defaultAbiCoder.encode(
                    ["address"],
                    [mastercopyAddress]
                  ),
                ]
              ),
            ]
          )
          .slice(-40)
      );

      if (log) console.log(`Proxy Address: ${gnosisSafeAddress}`);

      return gnosisSafeAddress;
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
