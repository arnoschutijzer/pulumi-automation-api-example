import { InlineProgramArgs, LocalWorkspace } from "@pulumi/pulumi/automation";
import { s3 } from "@pulumi/aws";
import { PolicyDocument } from "@pulumi/aws/iam";

const process = require('process');
const { KMS_KEY_ALIAS } = process.env;

const args = process.argv.slice(2);
let destroy = false;
if (args.length > 0 && args[0]) {
    destroy = args[0] === "destroy";
}

const run = async () => {
    // This is our pulumi program in "inline function" form
    const pulumiProgram = async () => {
        // Create a bucket and expose a website index document
        const siteBucket = new s3.Bucket("s3-website-bucket", {
            website: {
                indexDocument: "index.html",
            },
        });
        const indexContent = `<html><head>
<title>Hello S3</title><meta charset="UTF-8">
</head>
<body><p>Hello, world!</p><p>Made with ❤️ with <a href="https://pulumi.com">Pulumi</a></p>
</body></html>
`

        // write our index.html into the site bucket
        let object = new s3.BucketObject("index", {
            bucket: siteBucket,
            content: indexContent,
            contentType: "text/html; charset=utf-8",
            key: "index.html"
        });

        // Create an S3 Bucket Policy to allow public read of all objects in bucket
        function publicReadPolicyForBucket(bucketName): PolicyDocument {
            return {
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: "*",
                    Action: [
                        "s3:GetObject"
                    ],
                    Resource: [
                        `arn:aws:s3:::${bucketName}/*` // policy refers to bucket name explicitly
                    ]
                }]
            };
        }

        // Set the access policy for the bucket so all objects are readable
        let bucketPolicy = new s3.BucketPolicy("bucketPolicy", {
            bucket: siteBucket.bucket, // refer to the bucket created earlier
            policy: siteBucket.bucket.apply(publicReadPolicyForBucket) // use output property `siteBucket.bucket`
        });

        return {
            websiteUrl: siteBucket.websiteEndpoint,
        };
    };

    // Create our stack 
    const args: InlineProgramArgs = {
        stackName: "dev",
        projectName: "inlineNode",
        program: pulumiProgram
    };

    // Make this an env variable 
    const secretsProvider = `awskms://alias/${KMS_KEY_ALIAS}`

    // create (or select if one already exists) a stack that uses our inline program
    const stack = await LocalWorkspace.createOrSelectStack(args, {
        secretsProvider,
        // we should somehow save these stack settings
        // or alternatively always use the same one
        stackSettings: {
            [args.stackName]: {
                secretsProvider
            }
        },
        workDir: "."
    });

    console.info("successfully initialized stack");
    console.info("installing plugins...");
    await stack.workspace.installPlugin("aws", "v4.0.0");
    console.info("plugins installed");
    console.info("setting up config");
    // This can probably be removed?
    await stack.setConfig("aws:region", { value: "eu-west-1" });
    console.info("config set");
    console.info("refreshing stack...");
    await stack.refresh({ onOutput: console.info });
    console.info("refresh complete");

    if (destroy) {
        console.info("destroying stack...");
        await stack.destroy({ onOutput: console.info });
        console.info("stack destroy complete");
        process.exit(0);
    }

    console.info("updating stack...");
    const upRes = await stack.up({ onOutput: console.info });
    console.log(`update summary: \n${JSON.stringify(upRes.summary.resourceChanges, null, 4)}`);
    console.log(`website url: ${upRes.outputs.websiteUrl.value}`);
};

run().catch(err => console.log(err));